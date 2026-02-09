const config = {
	/**
	 * As we currently only need unused dependency checks, we disable all checks except for that
	 */
	rules: {
		files: "off",
		duplicates: "off",
		classMembers: "off",
		unlisted: "off",
		binaries: "off",
		unresolved: "off",
		catalog: "off",
		exports: "off",
		types: "off",
		enumMembers: "off",
	},

	ignoreDependencies: [
		"body-parser",
		"istanbul-lib-coverage",
		"istanbul-lib-instrument",
		"istanbul-lib-report",
		"istanbul-reports",
		"router",
		"serve-static",
		"eslint",
		"execa",
		"get-port",
		"nyc",
		"supertest",
		"@istanbuljs/esm-loader-hook"
	],
};

export default config;
