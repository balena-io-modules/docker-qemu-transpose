"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
const parser = require("docker-file-parser");
const fs = require("fs");
const generateQemuCopy = (options) => {
    return {
        name: 'COPY',
        args: [options.hostQemuPath, options.containerQemuPath]
    };
};
const transposeArrayRun = (options, command) => {
    return {
        name: 'RUN',
        args: [options.containerQemuPath, "-execve", "/bin/sh", "-c"].concat(command.args.join(' '))
    };
};
const transposeStringRun = (options, command) => {
    return {
        name: 'RUN',
        args: [options.containerQemuPath, "-execve", "/bin/sh", "-c"].concat([command.args])
        // args: [options.containerQemuPath].concat((<string[]>command.args).join(' '))
    };
};
const transposeRun = (options, command) => {
    if (_.isArray(command.args)) {
        return transposeArrayRun(options, command);
    }
    return transposeStringRun(options, command);
};
const identity = (options, command) => {
    return command;
};
const commandToTranspose = (command) => {
    if (command.name == 'RUN') {
        return transposeRun;
    }
    return identity;
};
const argsToString = (args) => {
    if (_.isArray(args)) {
        return '["' + args.join('","') + '"]';
    }
    else {
        return args;
    }
};
const commandsToDockerfile = (commands) => {
    let dockerfile = '';
    commands.map((command) => {
        dockerfile += `${command.name} ${argsToString(command.args)}\n`;
    });
    return dockerfile;
};
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
function transpose(dockerfile, options) {
    let output = '';
    // parse the Dokerfile
    const commands = parser.parse(dockerfile, { includeComments: false });
    const firstRunIdx = _.findIndex(commands, (command) => command.name == 'RUN');
    let outCommands = commands.slice(0, firstRunIdx);
    outCommands.push(generateQemuCopy(options));
    outCommands = outCommands.concat(commands.slice(firstRunIdx).map((command) => commandToTranspose(command)(options, command)));
    return commandsToDockerfile(outCommands);
}
exports.transpose = transpose;
const dockerfile = transpose(fs.readFileSync('Dockerfile.unemu').toString(), { hostQemuPath: 'qemu-arm', containerQemuPath: '/usr/local/bin/qemu' });
console.log(dockerfile);

//# sourceMappingURL=index.js.map
