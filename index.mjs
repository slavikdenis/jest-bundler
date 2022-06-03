import JestHasteMap from 'jest-haste-map';
import Resolver from 'jest-resolve';
import { DependencyResolver } from 'jest-resolve-dependencies';
import { cpus } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import yargs from 'yargs';
import fs from 'fs';

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
console.log(hasteFS.getAllFiles());

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

const dependencyResolver = new DependencyResolver(resolver, hasteFS);

const processedFiles = new Set();
const queue = [entryPoint];

while (!!queue.length) {
	// Pick first element from queue
	const module = queue.shift();
	// Process each module only once
	if (processedFiles.has(module)) {
		continue;
	}
	// Process module
	const moduleDependencies = dependencyResolver.resolve(module);
	queue.push(...moduleDependencies);
	// Mark module as processed
	processedFiles.add(module);
	// ^ This could be the part to add/remove test files or `require` calls
}

console.log(chalk.bold(`❯ Found ${chalk.blue(processedFiles.size)} files`));
console.log(Array.from(processedFiles));

/**
 * III. Serialize the bundle
 *
 * Serialization is the process of taking the dependency information
 * and all code to turn it into a bundle that we can be run as
 * a single file in a browser.
 *
 */

// Initial approach
console.log(chalk.bold(`❯ Serializing bundle`));
const allCode = [];
await Promise.all(
	Array.from(processedFiles).map(async (file) => {
		const code = await fs.promises.readFile(file, 'utf8');
		allCode.push(code);
	})
);
console.log(allCode.join('\n'));
// ^^^ includes require calls which browser doesn't understand
