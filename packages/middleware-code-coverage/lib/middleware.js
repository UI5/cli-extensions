// @ts-nocheck
import {
	createInstrumentationConfig,
	shouldInstrumentResource,
	getLatestSourceMap,
	readJsonFile,
	getLibraryCoverageExcludePatterns,
	instrumentBundle,
	isBundle,
	toDebugPath,
	fromDebugPath,
	isDebugPath
} from "./util.js";
import {createInstrumenter} from "istanbul-lib-instrument";
import reportCoverage from "./coverage-reporter.js";
import bodyParser from "body-parser";
import Router from "router";
import path from "node:path";
import serveStatic from "serve-static";
import {promisify} from "node:util";

/**
 * Custom middleware to instrument JS files with Istanbul.
 *
 * @param {object} parameters Parameters
 * @param {@ui5/logger/Logger} parameters.log
 *      Logger instance for use in the custom middleware.
 *      This parameter is only provided to custom middleware
 * @param {object} parameters.middlewareUtil Specification version dependent interface to a
 * 										[MiddlewareUtil]{https://ui5.github.io/cli/v3/api/@ui5_server_middleware_MiddlewareUtil.html} instance
 * @param {object} parameters.options Options
 * @param {object} [parameters.options.configuration] Custom server middleware configuration if given in ui5.yaml
 * @param {string} [parameters.options.configuration.bundleHandling] Controls how UI5 bundles
 * 										(e.g. <code>*-preload.js</code>) are handled. When unset (default), bundles are
 * 										treated like any other resource and the original per-file,
 * 										<code>?instrument</code> query-param-driven behavior applies.
 * 										<br><code>"instrument"</code>: bundles are instrumented in place and coverage is
 * 										attributed to the original source files via the bundle's indexed source map.
 * 										Every JS resource is instrumented regardless of the <code>?instrument</code>
 * 										query parameter, and the set of files included in the report is determined from
 * 										the client's report request.
 * 										<br><code>"unbundle"</code>: bundles are not served (404), forcing the runtime
 * 										to request individual modules. Each requested module is served from its
 * 										unminified source (the <code>-dbg</code> variant when the minify task is active)
 * 										and, when requested with <code>?instrument</code>, instrumented against it.
 * @param {object} parameters.builtResources Readers for accessing the build output.
 * 										Only provided for Specification Version 5.0 and later.
 * @param {module:@ui5/fs.AbstractReader} parameters.builtResources.all Reader to access the build output of the
 * 										root project and its dependencies
 * @param {module:@ui5/fs.AbstractReader} parameters.builtResources.rootProject Reader to access the build output of
 * 										the root project
 * @param {module:@ui5/fs.AbstractReader} parameters.builtResources.dependencies Reader to access the build output of
 * 										the project's dependencies
 * @returns {Function} Middleware function to use
 */
export default async function({log, middlewareUtil, options={}, builtResources}) {
	const config = await createInstrumentationConfig(options.configuration);
	const {
		report: reporterConfig,
		instrument: instrumenterConfig,
		bundleHandling,
		...generalConfig
	} = config;

	const instrumentMode = bundleHandling === "instrument";
	const unbundleMode = bundleHandling === "unbundle";

	const {version: middlewareVersion} = await readJsonFile(new URL("../package.json", import.meta.url));

	// Instrumenter instance
	const instrumenter = createInstrumenter(instrumenterConfig);
	const instrument = promisify(instrumenter.instrument.bind(instrumenter));

	const router = new Router();

	/**
	 * Handles Reporting requests
	 *
	 * Example:
	 *   fetch("/.ui5/coverage/report", {
	 *       method: "POST",
	 *       body: JSON.stringify(window.__coverage__),
	 *       headers: {
	 *           'Content-Type': 'application/json'
	 *       },
	 *   });
	 *
	 */
	router.post(
		"/.ui5/coverage/report",
		bodyParser.json({type: "application/json", limit: "50mb"}),
		async (req, res) => {
			const reportData = await reportCoverage(
				req.body ?? {},
				config,
				builtResources,
				log
			);

			if (reportData) {
				const body = JSON.stringify(reportData);
				res.writeHead(200, {"Content-Type": "application/json"});
				res.end(body);
			} else {
				res.writeHead(400, {"Content-Type": "application/json"});
				res.end(JSON.stringify({error: "No report data provided"}));
			}
		}
	);

	/**
	 * Endpoint to check for middleware existence
	 */
	router.get("/.ui5/coverage/ping", async (req, res) => {
		const body = JSON.stringify({version: middlewareVersion});
		res.writeHead(200, {"Content-Type": "application/json"});
		res.end(body);
	});

	/**
	 * Serves generated reports as static assets
	 */
	reporterConfig.reporter.forEach((reportType) =>
		router.use(
			`/.ui5/coverage/report/${reportType}`,
			serveStatic(
				path.join(config.cwd, reporterConfig["report-dir"], reportType)
			)
		)
	);

	let excludePatterns;

	router.use(async (req, res, next) => {
		// Lazy initialize exclude patterns
		if (excludePatterns === undefined) {
			// Custom patterns take precedence over .library defined patterns (also when set to null)
			if (generalConfig.excludePatterns !== undefined) {
				excludePatterns = generalConfig.excludePatterns;
			} else {
				// Read patterns from .library files, this should only be done if needed and only once
				excludePatterns = await getLibraryCoverageExcludePatterns(builtResources.all);
			}
		}

		if (unbundleMode) {
			// Unbundle mode has its own gating: bundles are 404'd unconditionally (independent of the
			// ?instrument query param) so the runtime falls back to individual modules; those modules
			// are instrumented only when requested with ?instrument.
			await handleUnbundled(req, res, next, excludePatterns);
			return;
		}

		// Skip files which should not be instrumented. In the "instrument" bundle mode the
		// ?instrument query param is ignored and every (non-excluded) JS resource is instrumented.
		if (!shouldInstrumentResource(req, excludePatterns, instrumentMode)) {
			next();
			return;
		}

		const pathname = middlewareUtil.getPathname(req);
		log.verbose(`handling ${pathname}...`);

		const matchedResource = await builtResources.all.byPath(pathname);

		if (!matchedResource) {
			log.warn(`${pathname} not found`);
			next();
			return;
		}

		const source = await matchedResource.getString();

		if (instrumentMode) {
			// Attempt bundle-aware instrumentation first: attribute coverage to the original source
			// files referenced by the bundle's indexed source map.
			const result = await instrumentBundle(
				source, pathname, builtResources.all, createInstrumenter, instrumenterConfig
			);
			if (result.indexed) {
				log.verbose(`...${pathname} instrumented as bundle for ${result.sources.length} source(s)!`);
				res.setHeader("Content-Type", "text/javascript");
				res.end(result.code);
				return;
			}
			// Not an indexed-map bundle: fall through to plain per-file instrumentation below.
		}

		sendInstrumented(res, await instrument(source, pathname), pathname);
	});

	/**
	 * Handles a request in "unbundle" mode.
	 *
	 * Every JS request is inspected: bundles are answered with 404 (independent of the
	 * <code>?instrument</code> query param) so the runtime falls back to requesting individual modules.
	 * Non-bundle modules are only instrumented when requested with <code>?instrument</code>; otherwise
	 * the request falls through to be served by the following middleware. The unminified source is
	 * preferred: when the minify task is active the runtime file (e.g. <code>Button.js</code>) holds
	 * minified code and the real source lives in the <code>-dbg</code> variant
	 * (<code>Button-dbg.js</code>); when minification is disabled the runtime file already is the source.
	 * The module is instrumented against, and reported as, its runtime path (without the
	 * <code>-dbg</code> infix) so coverage keys line up with what the client selects and what the
	 * reporter reads. The client requests both <code>Button.js</code> and, in browser debug mode,
	 * <code>Button-dbg.js</code> with <code>?instrument</code>; both resolve here to the same
	 * instrumented source.
	 *
	 * @param {object} req Request
	 * @param {object} res Response
	 * @param {Function} next Next middleware
	 * @param {Array<RegExp|string>} excludePatterns Instrumentation exclude patterns
	 */
	async function handleUnbundled(req, res, next, excludePatterns) {
		const pathname = middlewareUtil.getPathname(req);
		if (!pathname.endsWith(".js")) {
			next();
			return;
		}

		const requestedResource = await builtResources.all.byPath(pathname);
		if (!requestedResource) {
			// Let the following middleware handle it (e.g. respond with 404 itself).
			next();
			return;
		}

		const requestedSource = await requestedResource.getString();

		// Do not serve bundles at all: 404 makes the runtime load individual modules instead. This is
		// independent of ?instrument, so preloads requested without the query param are also blocked.
		if (isBundle(requestedSource)) {
			log.verbose(`${pathname} is a bundle, responding with 404 to force individual module loading`);
			res.statusCode = 404;
			res.end();
			return;
		}

		// From here on behave like the default mode: only instrument when the client opts in via
		// ?instrument and the resource is not excluded.
		if (!shouldInstrumentResource(req, excludePatterns)) {
			next();
			return;
		}

		log.verbose(`handling ${pathname}...`);

		// Report against the runtime path even when the browser requested the -dbg variant directly.
		const reportedPath = isDebugPath(pathname) ? fromDebugPath(pathname) : pathname;

		// Prefer the unminified -dbg source; fall back to the requested resource when no -dbg variant
		// exists (minify task disabled -> the runtime file already is the source).
		let source = requestedSource;
		if (!isDebugPath(pathname)) {
			const dbgResource = await builtResources.all.byPath(toDebugPath(pathname));
			if (dbgResource) {
				source = await dbgResource.getString();
			}
		}

		sendInstrumented(res, await instrument(source, reportedPath), reportedPath);
	}

	/**
	 * Sends instrumented source (with an embedded source map when enabled) as a JS response.
	 *
	 * @param {object} res Response
	 * @param {string} instrumentedSource Instrumented code
	 * @param {string} pathname Path used for logging
	 */
	function sendInstrumented(res, instrumentedSource, pathname) {
		log.verbose(`...${pathname} instrumented!`);

		// Append sourceMap
		if (instrumenterConfig.produceSourceMap) {
			instrumentedSource += getLatestSourceMap(instrumenter);

			log.verbose(`...${pathname} sourceMap embedded!`);
		}

		// send out instrumented source + source map
		res.setHeader("Content-Type", "text/javascript");
		res.end(instrumentedSource);
	}

	return router;
}
