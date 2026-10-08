const config = {
	/**
	 * We only need dependency checking at the moment,
	 * so all checks except for dependencies are turned off.
	 */
	rules: {
		files: "off",
		duplicates: "off",
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
		 * Used via nyc ava --node-arguments="--experimental-loader=@istanbuljs/esm-loader-hook"
		 * which is not detected by knip as a usage of this package
		 */
		"@istanbuljs/esm-loader-hook"
	],

	workspaces: {
		"packages/middleware-code-coverage": {
			/**
			 * UI5 custom middleware entry (see packages/middleware-code-coverage/ui5.yaml)
			 */
			entry: ["lib/middleware.js"],
			ava: {
				config: [
					"ava.config.js",
					"ava-integration.config.js"
				]
			}
		}
	}
};

export default config;
