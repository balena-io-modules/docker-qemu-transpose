"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Promise = require("bluebird");
const parser = require("docker-file-parser");
const jsesc = require("jsesc");
const _ = require("lodash");
const path = require("path");
const tar = require("tar-stream");
const streamToPromise = require('stream-to-promise');
const generateQemuCopy = (options) => {
    return {
        name: 'COPY',
        args: [options.hostQemuPath, options.containerQemuPath]
    };
};
const processArgString = (argString) => {
    return jsesc(argString, { quotes: 'double' });
};
const transposeArrayRun = (options, command) => {
    const args = command.args.map(processArgString).join(' ');
    return {
        name: 'RUN',
        args: [options.containerQemuPath, '-execve', '/bin/sh', '-c'].concat(args)
    };
};
const transposeStringRun = (options, command) => {
    const processed = processArgString(command.args);
    return {
        name: 'RUN',
        args: [options.containerQemuPath, '-execve', '/bin/sh', '-c'].concat([processed])
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
    if (command.name === 'RUN') {
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
    // parse the Dokerfile
    const commands = parser.parse(dockerfile, { includeComments: false });
    const firstRunIdx = _.findIndex(commands, (command) => command.name === 'RUN');
    let outCommands = commands.slice(0, firstRunIdx);
    outCommands.push(generateQemuCopy(options));
    outCommands = outCommands.concat(commands.slice(firstRunIdx).map((command) => commandToTranspose(command)(options, command)));
    return commandsToDockerfile(outCommands);
}
exports.transpose = transpose;
// FIXME: This is taken from resin-io-modules/resin-bundle-resolve
// export this code to a shared module and import it in this project
// and resin-bundle-resolve
function normalizeTarEntry(name) {
    const normalized = path.normalize(name);
    if (path.isAbsolute(normalized)) {
        return normalized.substr(normalized.indexOf('/') + 1);
    }
    return normalized;
}
exports.normalizeTarEntry = normalizeTarEntry;
const getTarEntryHandler = (pack, dockerfileName, opts) => {
    return (header, stream, next) => {
        streamToPromise(stream)
            .then((buffer) => {
            if (normalizeTarEntry(header.name) === dockerfileName) {
                const newDockerfile = transpose(buffer.toString(), opts);
                pack.entry({ name: 'Dockerfile' }, newDockerfile);
            }
            else {
                pack.entry(header, buffer);
            }
            next();
        });
    };
};
function transposeTarStream(tarStream, options, dockerfileName = 'Dockerfile') {
    const extract = tar.extract();
    const pack = tar.pack();
    return new Promise((resolve, reject) => {
        extract.on('entry', getTarEntryHandler(pack, dockerfileName, options));
        extract.on('finish', () => {
            pack.finalize();
            resolve(pack);
        });
        tarStream.pipe(extract);
    });
}
exports.transposeTarStream = transposeTarStream;

//# sourceMappingURL=index.js.map
