"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Promise = require("bluebird");
const parser = require("docker-file-parser");
const jsesc = require("jsesc");
const _ = require("lodash");
const path = require("path");
const tar = require("tar-stream");
const streamToPromise = require('stream-to-promise');
const es = require('event-stream');
const generateQemuCopy = (options) => {
    return {
        name: 'COPY',
        args: [options.hostQemuPath, options.containerQemuPath],
    };
};
const processArgString = (argString) => {
    return jsesc(argString, { quotes: 'double' });
};
const transposeArrayRun = (options, command) => {
    const args = command.args.map(processArgString).join(' ');
    return {
        name: 'RUN',
        args: [options.containerQemuPath, '-execve', '/bin/sh', '-c'].concat(args),
    };
};
const transposeStringRun = (options, command) => {
    const processed = processArgString(command.args);
    return {
        name: 'RUN',
        args: [options.containerQemuPath, '-execve', '/bin/sh', '-c'].concat([
            processed,
        ]),
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
const argsToString = (args, commandName) => {
    // ARG lines get parsed into an array, but this breaks the meaning in the output Dockerfile,
    // handle these seperately
    if (commandName === 'ARG') {
        return args[0];
    }
    if (_.isArray(args)) {
        return '["' + args.join('","') + '"]';
    }
    else {
        return args;
    }
};
const commandsToDockerfile = (commands) => {
    let dockerfile = '';
    commands.map(command => {
        dockerfile += `${command.name} ${argsToString(command.args, command.name)}\n`;
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
    outCommands = outCommands.concat(commands
        .slice(firstRunIdx)
        .map(command => commandToTranspose(command)(options, command)));
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
        streamToPromise(stream).then((buffer) => {
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
/**
 * transposeTarStream: Given a tar stream, this function will extract
 * the files, transpose the Dockerfile using the transpose function,
 * and then re-tar the original contents and the new Dockerfile, and
 * return a new tarStream
 */
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
/**
 * getBuildThroughStream: Get a through stream, which when piped to will remove all
 * extra output that is added as a result of this module transposing a Dockerfile.
 *
 * This function enables 'silent' emulated builds, with the only difference in output
 * from a native build being that there is an extra COPY step, where the emulator is
 * added to the container
 */
function getBuildThroughStream(opts) {
    // Regex to match against 'Step 1/5:', 'Step 1/5 :' 'Step 1:' 'Step 1 :'
    // and all lower case versions.
    const stepLineRegex = /^(?:step)\s\d+(?:\/\d+)?\s?:/i;
    const isStepLine = (str) => stepLineRegex.test(str);
    // Function to strip the string matched with the regex above
    const stripStepPrefix = (data) => {
        return data.substr(data.indexOf(':') + 1);
    };
    // Regex to match against the type of command, e.g. FROM, RUN, COPY
    const stepCommandRegex = /^\s?(\w+)(:?\s)/i;
    // Use type-coercion here to suppress TS `may be undefined` warnings, as we know
    // that function is only called with a value that will produce a non-undefined value
    const getStepCommand = (str) => stepCommandRegex.exec(str)[1].toUpperCase();
    // Regex to remove extra flags which this module adds in
    const replaceRegexString = _.escapeRegExp(`${opts.containerQemuPath} -execve /bin/sh -c `);
    const replaceRegex = new RegExp(replaceRegexString, 'i');
    const replaceQemuLine = (data) => {
        return data.replace(replaceRegex, '');
    };
    return es.pipe(es.mapSync(function (data) {
        data = data.toString();
        if (isStepLine(data) && getStepCommand(stripStepPrefix(data)) === 'RUN') {
            data = replaceQemuLine(data);
        }
        return data;
    }), es.join('\n'));
}
exports.getBuildThroughStream = getBuildThroughStream;

//# sourceMappingURL=index.js.map
