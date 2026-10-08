export default {
	files: [
		"test/integration/connect.js",
		"test/integration/bundle.js",
		"test/integration/build-tasks.js",
		"test/integration/exclude.js",
		"test/integration/dependency.js",
		"test/integration/app-ts.js"
	],
	// Each test starts a real `ui5 serve` and builds lazily on first request; allow generous time.
	timeout: "5m",
	watchMode: {
		ignoreChanges: [
			"tmp/**"
		]
	}
};
