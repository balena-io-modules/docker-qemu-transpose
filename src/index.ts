import * as Promise from 'bluebird'
import * as parser from 'docker-file-parser'
import * as fs from 'fs'
import * as jsesc from 'jsesc'
import * as _ from 'lodash'
import * as path from 'path'
import * as tar from 'tar-stream'

const streamToPromise = require('stream-to-promise')

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
