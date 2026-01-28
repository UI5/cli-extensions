import xml2js from "xml2js";
import {Buffer} from "node:buffer";
import {readFile} from "node:fs/promises";

/**
 * Returns the configuration for instrumenting the files
 *
 * @public
 * @param {object} configuration instrumentation configuration
 * @returns {Promise<object>} configuration
 */
export async function createInstrumentationConfig(configuration = {}) {
	const {instrument, report, ...generalConfig} = configuration;

	return {
		// General configuration
		cwd: "./",

		// General config overwrites
		...generalConfig,

		// Intrumenter configuration
		...{instrument: createInstrumenterConfig(instrument)},

		// Reporter configuration
		...{report: createReporterConfig(report)},
	};
}

/**
 * Returns the source map of the latest instrumented resource
 *
 * @public
 * @param {Instrumenter} instrumenter
 * @returns {string} sourceMap
 */
export function getLatestSourceMap(instrumenter) {
	const sourceMap = instrumenter.lastSourceMap();

	if (!sourceMap) {
		return "";
	}

	return (
		"\r\n//# sourceMappingURL=data:application/json;charset=utf-8;base64," +
		Buffer.from(JSON.stringify(sourceMap), "utf8").toString("base64")
	);
}

/**
 * Checks whether a request to resource should be instrumented
 *
 * @public
 * @param {object} request
 * @param {Array<RegExp|string>} excludePatterns Patterns to exclude file from instrumentation (RegExp or string)
 * @returns {boolean}
 */
export function shouldInstrumentResource(request, excludePatterns) {
	return (
		request.path &&
		request.path.endsWith(".js") && // Only .js file requests
		!isFalsyValue(request.query.instrument) && // instrument only flagged files, ignore "falsy" values
		!(excludePatterns || []).some((pattern) => {
			if (pattern instanceof RegExp) {
				// The ones coming from .library files are regular expressions
				return pattern.test(request.path);
			} else {
				return request.path.includes(pattern);
			}
		})
	);
}

/**
 * Returns the configuration for the instrumenter
 *
 * @private
 * @param {object} configuration
 * @returns {object}
 */
function createInstrumenterConfig(configuration = {}) {
	const defaultValues = {
		produceSourceMap: true,
		coverageGlobalScope: "window.top",
		coverageGlobalScopeFunc: false,
	};

	return {...defaultValues, ...configuration};
}

/**
 * Returns the configuration for the reporting
 *
 * @private
 * @param {object} configuration Reporting configuration
 * @returns {object}
 */
function createReporterConfig(configuration = {}) {
	const defaultValues = {
		"reporter": ["html"],
		"report-dir": "./tmp/coverage-reports",
		"watermarks": {
			statements: [50, 80],
			functions: [50, 80],
			branches: [50, 80],
			lines: [50, 80],
		},
	};

	return {...defaultValues, ...configuration};
}

/**
 * Determines if given <code>value</code> is falsy
 *
 * @private
 * @param {any} value
 * @returns {boolean} True when <code>value</code> is falsy, false if not
 */
function isFalsyValue(value) {
	return [false, 0, undefined, null, "false", "0", "undefined", "null"].includes(value);
}

/**
 * Analyzes .library files in order to check for jscoverage exclusions
 *
 * Note: .library: version="2.0" -> slash notation, and missing is "dot notation".
 * Note: We might consider to move this utility into the @ui5/project
 *
 * @private
 * @param {@ui5/fs/AbstractReader} reader
 * @returns {Promise<RegExp[]>} exclude patterns
 */
export async function getLibraryCoverageExcludePatterns(reader) {
	const aExcludes = [];
	// Read excludes from .library files
	const aDotLibrary = await reader.byGlob(["/resources/**/.library"]);
	for (const oDotLibrary of aDotLibrary) {
		const content = await oDotLibrary.getString();
		const result = await xml2js.parseStringPromise(content);
		if (
			!(
				result &&
				result.library &&
				result.library.appData &&
				result.library.appData[0] &&
				result.library.appData[0].jscoverage &&
				result.library.appData[0].jscoverage[0]
			)
		) {
			continue;
		}

		const oCoverage = result.library.appData[0].jscoverage[0];
		if (oCoverage.exclude) {
			for (let j = 0; j < oCoverage.exclude.length; j++) {
				const oExclude = oCoverage.exclude[j];

				// Excludes marked with 'external="true"' are intended for a library local
				// instrumentation only and should be ignored in a multi-library scenario
				if (oExclude.$.external === "true") {
					continue;
				}

				let sPattern = oExclude.$.name;

				// normalize the pattern
				sPattern = sPattern.replace(/\./g, "/");

				if (sPattern[0] === "/") {
					sPattern = "**" + sPattern;
				}
				if (sPattern.endsWith("/") && !sPattern.endsWith("**/")) {
					sPattern = sPattern + "**";
				}
				if (sPattern.endsWith("**")) {
					sPattern = sPattern + "/*";
				}

				// quote characters that might have been used but have a special meaning in regular expressions
				sPattern = sPattern
					.replaceAll("[", "\\[")
					.replaceAll("]", "\\]")
					.replaceAll("(", "\\(")
					.replaceAll(")", "\\)")
					.replaceAll(".", "\\.");
				// our wildcard '*' means 'any name segment, but not multiple components'
				sPattern = sPattern.replace(/\*/g, "[^/]*");
				// our wildcard '**/' means 'any number of name segments'
				sPattern = sPattern.replace(
					/\[\^\/\]\*\[\^\/\]\*\//g,
					"([^/]+[/])*"
				);
				sPattern = "(" + sPattern + ")";
				// add the resources path to the pattern
				sPattern = "/resources/(" + sPattern + ")(-dbg)?.js$";

				aExcludes.push(new RegExp(sPattern));
			}
		}
	}

	return aExcludes;
}

/**
 * Reads and parses the JSON file located on the given <code>filePath</code>
 *
 * @private
 * @param {string} filePath Path to JSON file
 * @returns {object} The object representation of the JSON file
 */
export async function readJsonFile(filePath) {
	const content = await readFile(filePath, "utf8");
	return JSON.parse(content);
}
