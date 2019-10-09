/**
 * @license
 * Copyright 2017-2019 Balena Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const gulp = require('gulp');
const gclean = require('gulp-clean');
const typescript = require('gulp-typescript');
const sourcemaps = require('gulp-sourcemaps');
const gmocha = require('gulp-mocha');
const tsnode = require('ts-node/register');
const tsProject = typescript.createProject('tsconfig.json');

const OPTIONS = {
	dirs: {
		sources: './src',
		build: './build',
	},
};

function test() {
	return gulp.src('tests/tests.ts').pipe(
		gmocha({
			require: ['ts-node/register'],
		}),
	);
}

function clean() {
	return gulp.src(OPTIONS.dirs.build, { read: false }).pipe(gclean());
}

function typescriptTask() {
	return tsProject
		.src()
		.pipe(sourcemaps.init())
		.pipe(tsProject())
		.on('error', console.log)
		.pipe(
			sourcemaps.write('./', {
				includeContent: true,
				sourceRoot: OPTIONS.dirs.sources,
				rootDir: '.',
			}),
		)
		.pipe(gulp.dest(OPTIONS.dirs.build));
}

exports.build = typescriptTask;
exports.clean = clean;
exports.test = test;
exports.default = exports.build;
