import globals from "globals";
import eslintCommonConfig from "./eslint.common.config.js";

export default [
	...eslintCommonConfig, // Load common ESLint config
	{
		files: ["**/*.cjs"],

		languageOptions: {
			ecmaVersion: 5,
			sourceType: "script",
		},
	},
	{
		files: ["test/integration/fixtures/ui5-app/webapp/**/*.js"],

		languageOptions: {
			globals: {
				...globals.browser,
				sap: "readonly",
				QUnit: "readonly",
			},
		},
	},
	{
		// Plain-JS fixtures (cross-project dependency + .library exclude probes, TS app bootstrap):
		// UI5 runtime sources.
		files: [
			"test/integration/fixtures/coverage-dep-app/webapp/**/*.js",
			"test/integration/fixtures/coverage-dep-lib/src/**/*.js",
			"test/integration/fixtures/coverage-app-ts/webapp/**/*.js",
		],

		languageOptions: {
			globals: {
				...globals.browser,
				sap: "readonly",
			},
		},
	},
	{
		files: ["test/integration/*.js"],

		rules: {
			"ava/no-ignored-test-files": "off",
		},
	},
	{
		files: ["lib/middleware.js"],
		rules: {
			"jsdoc/check-param-names": "off",
		},
	},
];
