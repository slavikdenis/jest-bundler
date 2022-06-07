import JestHasteMap from 'jest-haste-map';
import Resolver from 'jest-resolve';
import { cpus } from 'os';
import { join, dirname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import yargs from 'yargs';
import fs from 'fs';
import { transformSync } from '@babel/core';
import { Worker } from 'jest-worker';
import { minify } from 'terser';
import { execSync } from 'child_process';

/**
 * I. Efficiently search for all files on the file system
 */

// Get the root path to our project (Like `__dirname`).
const root = dirname(fileURLToPath(import.meta.url));

const hasteMapOptions = {
	extensions: ['js'], // Tells jest-haste-map to only crawl .js files.
	maxWorkers: cpus().length, // Parallelizes across all available CPUs.
	name: 'jest-bundler', // Used for caching.
	platforms: [], // This is only used for React Native, leave empty.
	rootDir: root, // The project root.
	roots: [root], // Can be used to only search a subset of files within `rootDir`.
};

// Need to use `.default` as of Jest 27.
const hasteMap = new JestHasteMap.default(hasteMapOptions);
await hasteMap.setupCachePath(hasteMapOptions);
const { hasteFS, moduleMap } = await hasteMap.build();

// CLI options
const options = yargs(process.argv).argv;
const entryPoint = resolve(process.cwd(), options.entryPoint ?? '');

if (!hasteFS.exists(entryPoint)) {
	throw new Error(
		'`--entry-point` does not exist. Please provide a path to a valid file.'
	);
}

console.log(chalk.bold(`❯ Building ${chalk.blue(options.entryPoint)}`));

/**
 * II. Resolve the dependency graph
 */

// `node product/entry-point.js`
// (Node resolution algorithm)[https://nodejs.org/api/modules.html#modules_all_together]

//  console.log(hasteFS.getDependencies(entryPoint));
// ^ gives dependency without full path

const resolver = new Resolver.default(moduleMap, {
	extensions: ['.js'],
	hasCoreModules: false,
	rootDir: root,
});

const seen = new Set();
const modules = new Map();
const queue = [entryPoint];
let id = 0;

while (!!queue.length) {
	// Pick first element from queue
	const module = queue.shift();

	// Process each module only once
	if (seen.has(module)) {
		continue;
	}
	seen.add(module);

	// Resolve each dependency and store it based on their required name
	const dependencyMap = new Map(
		hasteFS
			.getDependencies(module)
			.map((dependencyName) => [
				dependencyName,
				resolver.resolveModule(module, dependencyName),
			])
	);

	// Read the content of file (code)
	const code = fs.readFileSync(module, 'utf-8');
	// Extract body of the module (everything after `module.exports =`)
	// const moduleBody = code.match(/module\.exports\s+=\s+(.*?);/)?.[1] || '';
	const metadata = {
		// Assign an unique ID to each module
		id: id++,
		// code: moduleBody || code,
		code,
		dependencyMap,
	};
	modules.set(module, metadata);
	queue.push(...dependencyMap.values());
}

console.log(chalk.bold(`❯ Found ${chalk.blue(seen.size)} files`));

/**
 * III. Serialize the bundle
 *
 * Serialization is the process of taking the dependency information
 * and all code to turn it into a bundle that we can be run as
 * a single file in a browser.
 *
 */

console.log(chalk.bold(`❯ Serializing bundle`));

// Wrap modules with `define(<id>, function(module, exports, require) { <code> });` [see `require.js`]
const wrapModule = (id, code) =>
	`define(${id}, function(module, exports, require) {\n${code}});`;

const worker = new Worker(join(root, 'worker.js'), {
	enableWorkerThreads: true,
});

const results = await Promise.all(
	Array.from(modules)
		.reverse()
		.map(async ([module, metadata]) => {
			let { id, code } = metadata;
			({ code } = await worker.transformFile(code));

			for (const [dependencyName, dependencyPath] of metadata.dependencyMap) {
				const dependency = modules.get(dependencyPath);
				// Swap out the reference the required module with the generated module.
				// We will use regex for simplicity
				// ^ Real bundler would most likely use an AST transform using Babel or similar
				code = code.replace(
					new RegExp(
						// Escape '.' and '/'
						`require\\(('|")${dependencyName.replace(/[\/.]/g, '\\$&')}\\1\\)`
					),
					`require(${dependency.id})`
				);
			}
			return wrapModule(id, code);
		})
);

let output = [
	// Add the `require` runtime at the beginning of the bundle
	fs.readFileSync('./require.js', 'utf-8'),
	// Append the results
	...results,
	// Require entry point at the end of the bundle (ID=0 first file processed)
	'requireModule(0);',
].join('\n');

/**
 * Minifier
 */
let sourceMap = null;

if (options.minify) {
	console.log(chalk.bold(`❯ Minifying code`));

	const outputDirectory = options.output ? dirname(options.output) : null;

	const minifiedOutput = await minify(output, {
		sourceMap: !!options.output
			? {
					root: basename(options.output),
					url: `${basename(options.output)}.map`,
					includeSources: true,
			  }
			: {
					root: 'index.js',
					url: 'inline',
					includeSources: true,
			  },
	});

	output = minifiedOutput.code ?? output;
	sourceMap = minifiedOutput.map;
}

/**
 * Output
 */
if (options.output) {
	const outputDirectory = dirname(options.output);

	if (!fs.existsSync(outputDirectory)) {
		fs.mkdirSync(outputDirectory);
	}

	fs.writeFileSync(options.output, output, 'utf-8');

	if (sourceMap) {
		fs.writeFileSync(`${options.output}.map`, sourceMap, 'utf-8');
	}
} else {
	console.log(chalk.bold(`❯ Output\n`));
	console.log(chalk.bgCyan(output, '\n'));
}

worker.end();

/**
 * Development HTTP server
 */
if (options.dev) {
	console.log(chalk.bold(`❯ Running dev server\n`));

	// Write content for dev server
	const publicDirectory = join(root, 'public');

	if (!fs.existsSync(publicDirectory)) {
		fs.mkdirSync(publicDirectory);
	}

	const outputBaseName = options.output ? basename(options.output) : null;
	const outputFileName = outputBaseName ? outputBaseName : 'index.js';

	// Write JS file
	fs.writeFileSync(join(publicDirectory, outputFileName), output, 'utf-8');

	// Write Source map file
	if (sourceMap) {
		fs.writeFileSync(
			join(publicDirectory, `${outputFileName}.map`),
			sourceMap,
			'utf-8'
		);
	}

	// Write HTML file
	const htmlFile = `<!DOCTYPE html>
	<html>
		<body>
			<h2>Running dev HTTP server with bundled code</h2>
			<script src="${outputFileName}?v=${new Date().getTime()}"></script>
		</body>
	</html>
	`;

	fs.writeFileSync(join(publicDirectory, 'index.html'), htmlFile, 'utf-8');

	execSync('yarn start-dev-server', {
		cwd: root,
		encoding: 'utf-8',
		stdio: 'inherit',
	});
}
