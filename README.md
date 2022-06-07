# Basic bundler using Jest - concept

Based on [Building a JavaScript Bundler](https://cpojer.net/posts/building-a-javascript-bundler)

## Usage

```
node index.mjs
	--entry-point [entry_point] (required: entry point file)
	--output [path_to_output_file] (optional: output file path)
	--minify (optional: minification of output & generate source map)
	--dev (optional: start dev server)
```

## Functionality

- Efficiently search for all files on the file system
- Resolve the dependency graph
- Serialize the bundle
- Execute our bundle using a runtime
- Compile each file in parallel
- Minifying
- Development server
