const { transformAsync } = require('@babel/core');

exports.transformFile = async function (code) {
	const transformResult = { code: '' };
	try {
		const { code: transformedCode } = await transformAsync(code, {
			plugins: ['@babel/plugin-transform-modules-commonjs'],
		});

		transformResult.code = transformedCode ?? code;
	} catch (error) {
		transformResult.errorMessage = error.message;
	}
	return transformResult;
};
