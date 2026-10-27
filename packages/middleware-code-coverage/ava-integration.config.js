export default {
	files: [
		"test/integration/connect.js",
		"test/integration/bundle.js",
		"test/integration/build-tasks.js",
		"test/integration/exclude.js",
		"test/integration/dependency.js",
		"test/integration/app-ts.js",
		"test/integration/report.js"
	],
	// Run one test file at a time. Each boots a real `ui5 serve`, and several files share a fixture
	// (e.g. coverage-lib-ts). Running them in parallel races on per-fixture shared state: the lazy
	// `npm install` (ENOTEMPTY when workers reify the same node_modules at once) and the coverage
	// report dir (`tmp/coverage-reports`, where concurrent runs overwrite each other's report). Serial
	// execution removes both races; these heavyweight tests are few, so the wall-clock cost is small.
	concurrency: 1,
	// Each test starts a real `ui5 serve` and builds lazily on first request; allow generous time.
	timeout: "5m",
	watchMode: {
		ignoreChanges: [
			"tmp/**"
		]
	}
};
