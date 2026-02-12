const config = {
	/**
	 * We only need dependency checking at the moment,
	 * so all checks except for dependencies are turned off.
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
		/**
		 * Used in packages/middleware-code-coverage/test/integration/fixtures/ui5-app/package.json
		 * which is not part of the scope that knip analyzes
		 */
		"@ui5/cli",

		/**
		 * Used via nyc ava --node-arguments="--experimental-loader=@istanbuljs/esm-loader-hook"
		 * which is not detected by knip as a usage of this package
		 */
		"@istanbuljs/esm-loader-hook"
	],

	workspaces: {
		"packages/middleware-code-coverage": {
			entry: ["lib/*.js", "test/**/*.js"]
		}
	}
};

export default config;
