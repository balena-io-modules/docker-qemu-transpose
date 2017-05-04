import * as Promise from 'bluebird'
import * as parser from 'docker-file-parser'
import * as fs from 'fs'
import * as jsesc from 'jsesc'
import * as _ from 'lodash'
import * as path from 'path'
import * as tar from 'tar-stream'
import { EOL } from 'os'

const streamToPromise = require('stream-to-promise')
const es = require('event-stream')

/**
 * TransposeOptions:
 *	Options to be passed to the transpose module
 */
export interface TransposeOptions {
	/**
	 * hostQemuPath: the path of the qemu binary on the host
	 */
	hostQemuPath: string

	/**
	 * containerQemuPath: Where to add the qemu binary on-container
	 */
	containerQemuPath: string
}

type CommandTransposer = (options: TransposeOptions, command: parser.Command) => parser.Command

const generateQemuCopy = (options: TransposeOptions): parser.Command => {
	return {
		name: 'COPY',
		args: [options.hostQemuPath, options.containerQemuPath]
	}
}

const processArgString = (argString: string) => {
	return jsesc(argString, { quotes: 'double' })
}

const transposeArrayRun = (options: TransposeOptions, command: parser.Command): parser.Command => {
	const args = (command.args as string[]).map(processArgString).join(' ')
	return {
		name: 'RUN',
		args: [options.containerQemuPath, '-execve', '/bin/sh', '-c'].concat(args)
	}
}

const transposeStringRun = (options: TransposeOptions, command: parser.Command): parser.Command => {
 	const processed = processArgString(command.args as string)
	return {
		name: 'RUN',
		args:	[options.containerQemuPath, '-execve', '/bin/sh', '-c'].concat([processed])
	}
}

const transposeRun = (options: TransposeOptions, command: parser.Command): parser.Command => {
	if (_.isArray(command.args)) {
		return transposeArrayRun(options, command)
	}
	return transposeStringRun(options, command)
}

const identity = (options: TransposeOptions, command: parser.Command): parser.Command => {
	return command
}

const commandToTranspose = (command: parser.Command): CommandTransposer => {
	if (command.name === 'RUN') {
		return transposeRun
	}
	return identity
}

const argsToString = (args: string | { [key: string]: string } | string[]): string => {
	if (_.isArray(args)) {
		return '["' + args.join('","') + '"]'
	} else {
		return args as string
	}
}

const commandsToDockerfile = (commands: parser.Command[]): string => {
	let dockerfile = ''

	commands.map((command) => {
		dockerfile += `${command.name} ${argsToString(command.args)}\n`
	})
	return dockerfile
}

/**
 * transpose:
 *	Given a string representing a dockerfile, transpose it to use qemu
 *	rather than native, to enable emulated builds
 *
 * @param dockerfile
 *	A string representing the dockerfile
 * @param options
 *	OPtions to use when doing the transposing
 */
export function transpose(dockerfile: string, options: TransposeOptions): string {

	// parse the Dokerfile
	const commands = parser.parse(dockerfile, { includeComments: false })

	const firstRunIdx = _.findIndex(commands, (command) => command.name === 'RUN')

	let outCommands = commands.slice(0, firstRunIdx)

	outCommands.push(generateQemuCopy(options))

	outCommands = outCommands.concat(
		commands.slice(firstRunIdx).map(
			(command) => commandToTranspose(command)(options, command)
		)
	)

	return commandsToDockerfile(outCommands)
}

// FIXME: This is taken from resin-io-modules/resin-bundle-resolve
// export this code to a shared module and import it in this project
// and resin-bundle-resolve
export function normalizeTarEntry(name: string): string {
	const normalized = path.normalize(name)
	if (path.isAbsolute(normalized)) {
		return normalized.substr(normalized.indexOf('/') + 1)
	}
	return normalized
}

const getTarEntryHandler = (pack: tar.Pack, dockerfileName: string, opts: TransposeOptions) => {

	return (header: tar.TarHeader, stream: NodeJS.ReadableStream, next: (err?: Error) => void) => {
		streamToPromise(stream)
		.then((buffer: Buffer) => {
			if (normalizeTarEntry(header.name) === dockerfileName) {
				const newDockerfile = transpose(buffer.toString(), opts)
				pack.entry({ name: 'Dockerfile' }, newDockerfile)
			} else {
				pack.entry(header, buffer)
			}
			next()
		})
	}
}

/**
 * transposeTarStream: Given a tar stream, this function will extract
 * the files, transpose the Dockerfile using the transpose function,
 * and then re-tar the original contents and the new Dockerfile, and
 * return a new tarStream
 */
export function transposeTarStream(tarStream: NodeJS.ReadableStream,
                                   options: TransposeOptions,
                                   dockerfileName: string = 'Dockerfile') {
	const extract = tar.extract()
	const pack = tar.pack()

	return new Promise<NodeJS.ReadableStream>((resolve, reject) => {

		extract.on('entry', getTarEntryHandler(pack, dockerfileName, options))

		extract.on('finish', () => {
			pack.finalize()
			resolve(pack)
		})

		tarStream.pipe(extract)
	})
}

/**
 * getBuildThroughStream: Get a through stream, which when piped to will remove all
 * extra output that is added as a result of this module transposing a Dockerfile.
 *
 * This function enables 'silent' emulated builds, with the only difference in output
 * from a native build being that there is an extra COPY step, where the emulator is
 * added to the container
 */
export function getBuildThroughStream(opts: TransposeOptions): NodeJS.ReadWriteStream {

	// Regex to match against 'Step 1/5:', 'Step 1/5 :' 'Step 1:' 'Step 1 :'
	// and all lower case versions.
	const stepLineRegex = /^(?:step)\s\d+(?:\/\d+)?\s?:/i
	const isStepLine = (str: string) => stepLineRegex.test(str)

	// Function to strip the string matched with the regex above
	const stripStepPrefix = (data: string): string => {
		return data.substr(data.indexOf(':') + 1)
	}

	// Regex to match against the type of command, e.g. FROM, RUN, COPY
	const stepCommandRegex = /^\s?(\w+)(:?\s)/i
	// Use type-coercion here to suppress TS `may be undefined` warnings, as we know
	// that function is only called with a value that will produce a non-undefined value
	const getStepCommand = (str: string) => stepCommandRegex.exec(str)![1].toUpperCase()

	// Regex to remove extra flags which this module adds in
	const replaceRegexString = _.escapeRegExp(`${opts.containerQemuPath} -execve /bin/sh -c `)
	const replaceRegex = new RegExp(replaceRegexString, 'i')
	const replaceQemuLine = (data: string): string => {
		return data.replace(replaceRegex, '')
	}

	return es.pipe(
		es.mapSync(function(data: string | Buffer) {
			data = data.toString()

			if (isStepLine(data) && getStepCommand(stripStepPrefix(data)) === 'RUN') {
				data = replaceQemuLine(data)
			}
			return data
		}),
		es.join('\n')
	)
}
