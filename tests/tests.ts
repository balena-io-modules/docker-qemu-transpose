import * as Promise from 'bluebird'
import * as mocha from 'mocha'
import * as chai from 'chai'
import * as chaiAsPromised from 'chai-as-promised'
import * as fs from 'fs'
import * as tar from 'tar-stream'
import * as path from 'path'

import * as transpose from '../src/index'

chai.use(chaiAsPromised)
const expect = chai.expect


const opts: transpose.TransposeOptions = {
	hostQemuPath: 'hostQemu',
	containerQemuPath: 'containerQemu'
}

function getDockerfileFromTarStream(stream: NodeJS.ReadableStream): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const extract = tar.extract()
		let foundDockerfile = false

		extract.on('entry', (header: tar.TarHeader, stream: NodeJS.ReadableStream, next: () => void) => {
			if (path.normalize(header.name) === 'Dockerfile') {
				let contents = ''
				stream.on('data', (data: string) => {
					contents += data
				})
				stream.on('end', () => {
					foundDockerfile = true
					resolve(contents)
				})
			}
			next()
		})

		extract.on('finish', () => {
			if (!foundDockerfile) {
				reject('Could not find a dockerfile in returned archive')
			}
		})
		stream.pipe(extract)
	})
}


describe('Transpose a Dockerfile', () => {

	it('should transpose a Dockerfile', () => {
		const dockerfile = `
		FROM ubuntu
		COPY my-file my-container-file
		RUN apt-get install something
		RUN ["ls", "-al"]
		`

		const expectedOutput = `FROM ubuntu
COPY ["my-file","my-container-file"]
COPY ["${opts.hostQemuPath}","${opts.containerQemuPath}"]
RUN ["${opts.containerQemuPath}","-execve","/bin/sh","-c","apt-get install something"]
RUN ["${opts.containerQemuPath}","-execve","/bin/sh","-c","ls -al"]
`

		expect(transpose.transpose(dockerfile, opts)).to.equal(expectedOutput)

	})

	it('should escape double quotes', () => {
		const dockerfile = `FROM ubuntu
		RUN bash -c "ls -l"
		RUN ["bash", "-c", "echo", "a \\"string\\" with \\"quotes\\""]
		`

		const expectedOutput = `FROM ubuntu
COPY ["${opts.hostQemuPath}","${opts.containerQemuPath}"]
RUN ["${opts.containerQemuPath}","-execve","/bin/sh","-c","bash -c \\"ls -l\\""]
RUN ["${opts.containerQemuPath}","-execve","/bin/sh","-c","bash -c echo a \\"string\\" with \\"quotes\\""]
`
		expect(transpose.transpose(dockerfile, opts)).to.equal(expectedOutput)
	})

})

describe('Transpose a tar stream', () => {

	it('should transpose a valid tar stream', () => {
		const expectedOutput = `FROM ubuntu
WORKDIR /usr/src/app
COPY ["${opts.hostQemuPath}","${opts.containerQemuPath}"]
RUN ["${opts.containerQemuPath}","-execve","/bin/sh","-c","touch file && bash -c \\"something\\""]
RUN ["${opts.containerQemuPath}","-execve","/bin/sh","-c","apt-get update && apt-get install build-essential"]
CMD bash -c "sleep 12"
`
		// open a tar stream
		const stream = fs.createReadStream('./tests/test-files/valid-archive.tar')

		return transpose.transposeTarStream(stream, opts)
			.then((stream) => {
				return expect(getDockerfileFromTarStream(stream)).eventually.to.equal(expectedOutput)
			})
	})
})
