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
 * @param {boolean} [instrumentAll=false] When true, instrument every JS resource regardless of the
 *      <code>?instrument</code> query parameter. Used by the <code>instrument</code> bundle mode.
 * @returns {boolean}
 */
export function shouldInstrumentResource(request, excludePatterns, instrumentAll = false) {
	if (!request.url) {
		return false;
	}
	const {pathname, searchParams} = new URL(request.url, "http://localhost");
	return (
		pathname.endsWith(".js") &&
		// In the "instrument" bundle mode the ?instrument query param is ignored: all JS is
		// instrumented and the selection of relevant files happens later, at reporting time.
		(instrumentAll || !isFalsyValue(searchParams.get("instrument"))) &&
		!(excludePatterns || []).some((pattern) => {
			if (pattern instanceof RegExp) {
				return pattern.test(pathname);
			} else {
				return pathname.includes(pattern);
			}
		})
	);
}

/**
 * UI5 bundles carry a <code>//@ui5-bundle &lt;name&gt;</code> marker on their first line. Other
 * markers such as <code>//@ui5-bundle-raw-include</code> exist as well, so the trailing space is
 * significant and must be matched to avoid false positives.
 *
 * Middlewares have no access to resource tags (e.g. <code>STANDARD_TAGS.IsBundle</code>), so the
 * marker comment is used as an equivalent signal.
 *
 * @public
 * @param {string} code Resource content
 * @returns {boolean} True if the content is a UI5 bundle
 */
export function isBundle(code) {
	const firstLine = code.slice(0, code.indexOf("\n") === -1 ? code.length : code.indexOf("\n"));
	return /^\/\/@ui5-bundle /.test(firstLine);
}

// Mirrors the debug-variant naming applied by the UI5 builder's minifier task: the "-dbg" infix is
// inserted before the (optional) UI5 file-type segment and the ".js" extension, e.g.
// "App.controller.js" -> "App-dbg.controller.js", "Button.js" -> "Button-dbg.js".
const debugFileRegex = /((?:\.view|\.fragment|\.controller|\.designtime|\.support)?\.js)$/;

/**
 * Returns the debug-variant path for a runtime resource path, as produced by the minifier task.
 *
 * @public
 * @param {string} pathname Runtime resource path (e.g. <code>/resources/ns/Button.js</code>)
 * @returns {string} Debug-variant path (e.g. <code>/resources/ns/Button-dbg.js</code>)
 */
export function toDebugPath(pathname) {
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

/**
 * Loads and parses the source map referenced by a bundle's <code>//# sourceMappingURL=</code> comment.
 *
 * Handles both inline data-URI maps and external map files sibling to the bundle. UI5 production
 * bundles reference an external <code>*.js.map</code>; that file is read from the given reader,
 * resolved relative to the bundle's own directory.
 *
 * @private
 * @param {string} code Bundle source
 * @param {string} bundlePathname Request pathname of the bundle (used to resolve external map URLs)
 * @param {module:@ui5/fs.AbstractReader} reader Reader to resolve an external map file
 * @returns {Promise<object|undefined>} The parsed source map, or <code>undefined</code> if none is found
 */
async function loadSourceMap(code, bundlePathname, reader) {
	const m = code.match(/\/\/[#@]\s*sourceMappingURL=(.+?)\s*$/m);
	if (!m) {
		return undefined;
	}
	const url = m[1].trim();
	const base64 = url.match(/^data:application\/json[^,]*;base64,(.*)$/);
	if (base64) {
		return JSON.parse(Buffer.from(base64[1], "base64").toString("utf8"));
	}
	const dataUri = url.match(/^data:application\/json[^,]*,(.*)$/);
	if (dataUri) {
		return JSON.parse(decodeURIComponent(dataUri[1]));
	}

	// External map file: resolve relative to the bundle's directory and read it from the reader.
	const mapPath = resolvePosix(posixDirname(bundlePathname), url);
	const mapResource = await reader.byPath(mapPath);
	if (!mapResource) {
		return undefined;
	}
	return JSON.parse(await mapResource.getString());
}

/**
 * A section maps to actual JS source only if it names a source that is not a pure-data blob
 * (bundle-code segments, .properties/.json/.xml resources). Those are kept verbatim but not
 * instrumented, so the resulting bundle stays runnable.
 *
 * @private
 * @param {string|undefined} source Source name as referenced by the section map
 * @returns {boolean}
 */
function isInstrumentableSource(source) {
	return !!source && !/\?bundle-code|\.properties$|\.json$|\.xml$/.test(source);
}

/**
 * POSIX-style dirname for resource pathnames (which always use forward slashes).
 *
 * @private
 * @param {string} p
 * @returns {string}
 */
function posixDirname(p) {
	const i = p.lastIndexOf("/");
	return i <= 0 ? "/" : p.slice(0, i);
}

/**
 * Resolves <code>segments</code> against a POSIX <code>base</code> pathname, collapsing
 * <code>.</code> and <code>..</code>. Used to resolve a section's source (with its sourceRoot)
 * to an absolute resource pathname relative to the bundle's directory.
 *
 * @private
 * @param {string} base Absolute base pathname
 * @param {...string} segments Path segments to append
 * @returns {string} Absolute, normalized POSIX pathname
 */
function resolvePosix(base, ...segments) {
	const parts = [];
	for (const part of [base, ...segments].join("/").split("/")) {
		if (part === "" || part === ".") {
			continue;
		}
		if (part === "..") {
			parts.pop();
		} else {
			parts.push(part);
		}
	}
	return "/" + parts.join("/");
}

/**
 * Instruments a UI5 bundle (e.g. <code>*-preload.js</code>) for code coverage, attributing coverage
 * to the individual original source files rather than to the bundle as a whole.
 *
 * UI5 bundles ship with an <em>indexed</em> source map (a map with a <code>sections</code> array).
 * Each section maps a contiguous run of bundle lines back to one original source. Every section is
 * turned into a self-contained, plain source map for just that slice of the bundle, and each slice
 * is handed to istanbul together with its map. istanbul rewrites the coverage counters through the
 * input source map, so the emitted coverage is keyed by the original file names.
 *
 * The section maps of a production bundle reference the UI5 <code>*-dbg.js</code> debug files but do
 * not embed their content. To have the report render the original (unminified) source rather than the
 * minified bundle text, the <code>-dbg</code> content is read from <code>reader</code> and embedded
 * into each slice's source map. The bundle's mappings target that <code>-dbg</code> content.
 *
 * Bundles without an indexed source map are returned unchanged (with an empty <code>sources</code>
 * list), leaving it to the caller to fall back to plain per-file instrumentation.
 *
 * @public
 * @param {string} bundleCode The bundle source
 * @param {string} pathname Request pathname of the bundle
 * @param {module:@ui5/fs.AbstractReader} reader Reader to resolve the external source map and
 *      <code>-dbg</code> source files
 * @param {Function} createInstrumenter Factory from istanbul-lib-instrument
 * @param {object} instrumenterConfig Base instrumenter configuration
 * @returns {Promise<{code: string, sources: string[], indexed: boolean}>} The instrumented bundle, the
 *      list of original source paths coverage is reported for, and whether an indexed map was found
 */
export async function instrumentBundle(bundleCode, pathname, reader, createInstrumenter, instrumenterConfig) {
	const indexedMap = await loadSourceMap(bundleCode, pathname, reader);

	if (!indexedMap || !Array.isArray(indexedMap.sections)) {
		// Not an indexed-map bundle: nothing bundle-specific to do here.
		return {code: bundleCode, sources: [], indexed: false};
	}

	const bundleDir = posixDirname(pathname);
	const bundleLines = bundleCode.split("\n");
	const sections = indexedMap.sections;
	const instrumentedSlices = [];
	const coveredSources = [];

	for (let i = 0; i < sections.length; i++) {
		const section = sections[i];
		const {line: startLine, column: startCol} = section.offset;
		// A section runs until the next section's offset (or the end of the bundle).
		const endLine =
			i + 1 < sections.length ? sections[i + 1].offset.line : bundleLines.length;

		// Offsets are 0-based lines.
		const sliceLines = bundleLines.slice(startLine, endLine);
		if (startCol > 0 && sliceLines.length > 0) {
			sliceLines[0] = sliceLines[0].slice(startCol);
		}
		const sliceCode = sliceLines.join("\n");

		const sectionMap = section.map;
		const source = sectionMap?.sources?.[0];

		if (!sectionMap || !isInstrumentableSource(source)) {
			// Keep pure-data sections (bundle-code blobs, .properties, ...) verbatim so the output
			// bundle remains runnable.
			instrumentedSlices.push(sliceCode);
			continue;
		}

		// Resolve the referenced source to an absolute resource pathname. The source name is relative
		// to the section's own sourceRoot (e.g. "controller"), itself relative to the bundle's
		// directory: "App-dbg.controller.js" (+ "controller") -> "/resources/<ns>/controller/App-dbg.controller.js".
		const dbgPath = resolvePosix(
			bundleDir,
			indexedMap.sourceRoot || "",
			sectionMap.sourceRoot || "",
			source
		);

		// The report renders the map's sourcesContent, so embed the unminified -dbg content. Prefer
		// content already inlined in the section map; otherwise read the -dbg file from the reader.
		let sourceContent = Array.isArray(sectionMap.sourcesContent) ?
			sectionMap.sourcesContent[0] :
			undefined;
		if (sourceContent == null) {
			const dbgResource = await reader.byPath(dbgPath);
			if (!dbgResource) {
				// Without content we cannot instrument meaningfully against the original source;
				// keep the slice verbatim.
				instrumentedSlices.push(sliceCode);
				continue;
			}
			sourceContent = await dbgResource.getString();
		}

		// Report coverage against the plain runtime file names (Component.js, App.controller.js) so
		// keys line up with the resources the reporter reads and the paths the client filters on.
		const reportedPath = dbgPath.replace(/-dbg(\.[^.]+(?:\.[^.]+)?)$/, "$1");

		const sliceMap = {
			version: 3,
			file: reportedPath,
			names: sectionMap.names ?? [],
			sources: [reportedPath],
			sourcesContent: [sourceContent],
			mappings: sectionMap.mappings,
		};

		// A fresh instrumenter per slice keeps each file's coverage isolated and lets istanbul
		// consume the slice's own input map. UI5 preloads are plain scripts (sap.ui.predefine
		// calls), hence esModules: false.
		const instrumenter = createInstrumenter({
			...instrumenterConfig,
			esModules: false,
			compact: true,
		});

		instrumentedSlices.push(
			instrumenter.instrumentSync(sliceCode, reportedPath, sliceMap)
		);
		coveredSources.push(reportedPath);
	}

	return {code: instrumentedSlices.join("\n"), sources: coveredSources, indexed: true};
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
