"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Promise = require("bluebird");
const _ = require("lodash");
const parser = require("docker-file-parser");
const tar = require("tar-stream");
const path = require("path");
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
function transposeTarStream(tarStream, options, dockerfileName = 'Dockerfile') {
    const extract = tar.extract();
    const pack = tar.pack();
    return new Promise((resolve, reject) => {
        extract.on('entry', (header, stream, next) => {
            if (normalizeTarEntry(header.name) == dockerfileName) {
                // If the file is a Dockerfile, first read it into a string,
                // transpose it, then push it back to the tar stream
                let contents = '';
                stream.on('data', (data) => {
                    contents += data.toString();
                });
                stream.on('end', () => {
                    let newContent = transpose(contents, options);
                    pack.entry({ name: 'Dockerfile', size: newContent.length }, newContent);
                    next();
                });
            }
            else {
                const entry = pack.entry(header, (err) => {
                    if (_.isError(err)) {
                        reject(err);
                    }
                });
                stream.pipe(entry);
                stream.on('end', next);
            }
        });
        extract.on('finish', () => {
            resolve(pack);
        });
        extract.on('error', reject);
        tarStream.pipe(extract);
    });
}
exports.transposeTarStream = transposeTarStream;

//# sourceMappingURL=index.js.map
