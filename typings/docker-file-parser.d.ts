declare module 'docker-file-parser' {
	export interface ParseOptions {
		includeComments: boolean;
	}

	export interface Command {
		name: string;
		args: string[] | { [key: string]: string } | string;
		lineno?: number;
		error?: Error;
		raw?: string;
	}

	export function parse(dockerfile: string, options: ParseOptions): Command[];
}
