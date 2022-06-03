const modules = new Map();

const define = (name, moduleFactory) => {
	modules.set(name, moduleFactory);
};

const moduleCache = new Map();

const requireModule = (name) => {
	if (moduleCache.has(name)) {
		return moduleCache.get(name).exports;
	}

	if (!modules.has(name)) {
		throw new Error(`Module '${name}' does not exist.`);
	}

	const moduleFactory = modules.get(name);
	const module = {
		exports: {},
	};
	moduleCache.set(name, module);
	moduleFactory(module, module.exports, requireModule);
	return module.exports;
};

define(5, function(module, exports, require) {
module.exports = 'tomato';
});
define(4, function(module, exports, require) {
module.exports = 'melon';
});
define(3, function(module, exports, require) {
module.exports = 'kiwi ' + require(4) + ' ' + require(5);
});
define(2, function(module, exports, require) {
module.exports = 'banana ' + require(3);
});
define(1, function(module, exports, require) {
module.exports = 'apple ' + require(2) + ' ' + require(3);
});
define(0, function(module, exports, require) {
console.log(require(1));
});
requireModule(0);