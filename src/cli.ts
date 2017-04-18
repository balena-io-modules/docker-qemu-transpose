import { transpose } from './index'

const usage = () => {
	console.log('Usage: qemu-transpose Dockerfile')
}

if (process.argv.length < 1) {
	usage()
	process.exit()
}


