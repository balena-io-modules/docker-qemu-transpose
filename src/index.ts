import * as _ from 'lodash'
import * as parser from 'docker-file-parser'
import * as fs from 'fs'

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

const transposeArrayRun = (options: TransposeOptions, command: parser.Command): parser.Command => {
	return {
		name: 'RUN',
		args: [options.containerQemuPath, "-execve", "/bin/sh", "-c"].concat((<string[]>command.args).join(' '))
	}
}

const transposeStringRun = (options: TransposeOptions, command: parser.Command): parser.Command => {
	return {
		name: 'RUN',
		args: [options.containerQemuPath, "-execve", "/bin/sh", "-c"].concat([<string>command.args])
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
	if (command.name == 'RUN') {
		return transposeRun
	}
	return identity
}

const argsToString = (args: string | { [key: string]: string } | string[]): string => {
	if (_.isArray(args)) {
		return '["' + args.join('","') + '"]'
	} else {
		return <string>args
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
	let output = ''

	// parse the Dokerfile
	const commands = parser.parse(dockerfile, { includeComments: false })

	const firstRunIdx = _.findIndex(commands, (command) => command.name == 'RUN')

	let outCommands = commands.slice(0, firstRunIdx)

	outCommands.push(generateQemuCopy(options))


	outCommands = outCommands.concat(
		commands.slice(firstRunIdx).map(
			(command) => commandToTranspose(command)(options, command)
		)
	)

	return commandsToDockerfile(outCommands)
}

