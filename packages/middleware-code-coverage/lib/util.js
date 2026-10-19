import xml2js from "xml2js";
import {Buffer} from "node:buffer";
import {readFile} from "node:fs/promises";
import path from "node:path";

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
	if (!request.url) {
		return false;
	}
	const {pathname, searchParams} = new URL(request.url, "http://localhost");
	// Match exclude patterns against the runtime path: coverage runs request the unminified `-dbg`
	// variant, but patterns (and the coverage report keys) are expressed in runtime terms, so a
	// `-dbg` request must be normalized first — otherwise a filename-pinned exclude (e.g.
	// "Control1.js" or /Control1\.js$/) would silently fail to match "Control1-dbg.js".
	const runtimePath = fromDebugPath(pathname);
	return (
		runtimePath.endsWith(".js") &&
		!isFalsyValue(searchParams.get("instrument")) &&
		!(excludePatterns || []).some((pattern) => {
			if (pattern instanceof RegExp) {
				return pattern.test(runtimePath);
			} else {
				return runtimePath.includes(pattern);
			}
		})
	);
}

// Mirrors the debug-variant naming applied by the UI5 builder's minifier task: the "-dbg" infix is
// inserted before the (optional) UI5 file-type segment and the ".js" extension, e.g.
// "App.controller.js" -> "App-dbg.controller.js", "Button.js" -> "Button-dbg.js".
const debugFileRegex = /((?:\.view|\.fragment|\.controller|\.designtime|\.support)?\.js)$/;

/**
 * Returns the debug-variant path for a runtime resource path, as produced by the minifier task.
 * Idempotent: a path that already is a debug variant is returned unchanged (so callers do not have
 * to guard against producing a <code>-dbg-dbg</code> path).
 *
 * @public
 * @param {string} pathname Runtime resource path (e.g. <code>/resources/ns/Button.js</code>)
 * @returns {string} Debug-variant path (e.g. <code>/resources/ns/Button-dbg.js</code>)
 */
export function toDebugPath(pathname) {
	if (isDebugPath(pathname)) {
		return pathname;
	}
	return pathname.replace(debugFileRegex, "-dbg$1");
}

/**
 * Returns the runtime (non-debug) path for a debug-variant resource path. Inverse of
 * {@link toDebugPath}; a path that is not a debug variant is returned unchanged.
 *
 * @public
 * @param {string} pathname Resource path
 * @returns {string} Runtime path with any <code>-dbg</code> infix removed
 */
export function fromDebugPath(pathname) {
	return pathname.replace(/-dbg((?:\.view|\.fragment|\.controller|\.designtime|\.support)?\.js)$/, "$1");
}

/**
 * Whether a resource path already is a debug variant (carries the <code>-dbg</code> infix).
 *
 * @public
 * @param {string} pathname Resource path
 * @returns {boolean}
 */
export function isDebugPath(pathname) {
	return /-dbg(?:\.view|\.fragment|\.controller|\.designtime|\.support)?\.js$/.test(pathname);
}

// UI5 bundles begin with a `//@ui5-bundle` marker (emitted by the bundler tasks, recognized by the
// ui5loader). Matched at the very start of the file.
const bundleContentMarker = /^\s*\/\/@ui5-bundle/;

/**
 * Whether source code is a UI5 bundle (e.g. <code>*-preload.js</code>), detected by its leading
 * <code>//@ui5-bundle</code> marker.
 *
 * Such a bundle must never be instrumented: its concatenated, indexed source map would crash istanbul
 * and the merged source would corrupt coverage.
 *
 * @public
 * @param {string} source Resource source code
 * @returns {boolean} True if the source begins with the UI5 bundle marker
 */
export function isBundleSource(source) {
	return typeof source === "string" && bundleContentMarker.test(source);
}

// Mirrors the UI5 builder's sourceMappingURL handling (@ui5/builder minifier.js / lbt/bundle/Builder.js):
// match the reference the builder writes, and resolve a base64 data-URI inline map or a relative
// external map. Other encodings and absolute URLs/paths are unsupported, matching the builder.
const sourceMappingUrlPattern = /\/\/# sourceMappingURL=(\S+)\s*$/;
const httpPattern = /^https?:\/\//i;

/**
 * Loads the input source map referenced by a resource's <code>sourceMappingURL</code> comment, so
 * coverage can be attributed to the original source (e.g. a TypeScript project's <code>-dbg</code>
 * source mapping back to the <code>.ts</code>).
 *
 * Handles a base64 data-URI inline map and a relative external map (resolved against the resource's
 * path and read from the given reader). Returns <code>undefined</code> when there is no map, it is an
 * unsupported reference, or it cannot be read or parsed — the caller then instruments without an input
 * map (coverage stays keyed to the runtime path).
 *
 * @public
 * @param {string} sourceCode The resource content to scan for a <code>sourceMappingURL</code>
 * @param {string} sourcePathname The resource's request path (used to resolve a relative map URL)
 * @param {module:@ui5/fs.AbstractReader} reader Reader to resolve an external map file
 * @param {@ui5/logger/Logger} [log] Logger for surfacing an unsupported/unreadable map
 * @returns {Promise<object|undefined>} The parsed source map, or <code>undefined</code>
 */
export async function loadInputSourceMap(sourceCode, sourcePathname, reader, log) {
	const match = sourceCode.match(sourceMappingUrlPattern);
	if (!match) {
		return undefined;
	}
	const sourceMappingUrl = match[1];
	try {
		if (sourceMappingUrl.startsWith("data:")) {
			const expectedTypeAndEncoding = "data:application/json;charset=utf-8;base64,";
			if (!sourceMappingUrl.startsWith(expectedTypeAndEncoding)) {
				log?.warn(`Unsupported source map data-URI encoding for ${sourcePathname}: ${sourceMappingUrl}`);
				return undefined;
			}
			const base64 = sourceMappingUrl.slice(expectedTypeAndEncoding.length);
			return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
		}
		if (httpPattern.test(sourceMappingUrl)) {
			log?.warn(`Unsupported absolute source map URL for ${sourcePathname}: ${sourceMappingUrl}`);
			return undefined;
		}
		if (path.posix.isAbsolute(sourceMappingUrl)) {
			log?.warn(`Unsupported absolute source map path for ${sourcePathname}: ${sourceMappingUrl}`);
			return undefined;
		}
		const mapPath = path.posix.join(path.posix.dirname(sourcePathname), sourceMappingUrl);
		const mapResource = await reader.byPath(mapPath);
		if (!mapResource) {
			return undefined;
		}
		return JSON.parse(await mapResource.getString());
	} catch (err) {
		log?.verbose(`Ignoring unreadable source map for ${sourcePathname}: ${err.message}`);
		return undefined;
	}
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
