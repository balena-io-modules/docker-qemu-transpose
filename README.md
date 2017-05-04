# Tranpose a Dockerfile for emulated builds

Using this module as a pre-processor for Dockerfiles which will not run on your
system natively, along with a version of `qemu-linux-user` suitable for
emulation, will produce a Dockerfile which will run seamlessly.

## Usage

`docker-qemu-transpose` has a simple API, with two main functions;

* `tranpose(dockerfile: string, options: TranposeOptions): string`

Given a Dockerfile and tranpose options, produce a Dockerfile which will run on
the same architecture as the qemu provided in options (detailed below).

* `transposeTarStream(tarStream: ReadableStream, options: TransposeOptions, dockerfileName = 'Dockerfile'): Promise<ReadableStream>`

Given a tar archive stream, this function will extract the Dockerfile (or
file named with the given `dockerfileName` parameter) and transpose it. It then
creates a new tar stream, and returns it wrapped in a bluebird Promise.

* `getBuildThroughStream(options: TransposeOptions): ReadWriteStream`

Get a through stream, which when piped to will remove all
extra output that is added as a result of this module transposing a Dockerfile.

This function enables 'silent' emulated builds, with the only difference in output
from a native build being that there is an extra COPY step, where the emulator is
added to the container


## Options

* `TranposeOptions` is an interface with two required fields;
	* `hostQemu` - The location of the qemu binary on the host filesystem
	* `containerQemu` - Where qemu should live on the built container

## Notes

A version of qemu with execve support is required, which can be retrieved
from https://github.com/resin-io/qemu.
