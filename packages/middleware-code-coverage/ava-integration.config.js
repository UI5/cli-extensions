export default {
	files: [
		"test/integration/connect.js",
		"test/integration/v5-bundle.js",
		"test/integration/v5-build-tasks.js",
		"test/integration/v5-exclude.js",
		"test/integration/v5-dependency.js",
		"test/integration/v5-app-ts.js"
	],
	watchMode: {
		ignoreChanges: [
			"tmp/**"
		]
	}
};
