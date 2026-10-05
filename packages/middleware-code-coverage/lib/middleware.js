// @ts-nocheck
import {
	createInstrumentationConfig,
	shouldInstrumentResource,
	getLatestSourceMap,
	readJsonFile,
	getLibraryCoverageExcludePatterns,
	toDebugPath,
	fromDebugPath,
	isDebugPath,
	isBundleResource
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
 * Coverage runs against the build output (<code>builtResources</code>). To obtain faithful per-file
 * coverage the client is expected to load the coverage test page with
 * <code>sap-ui-debug="&lt;cover globs&gt;"</code>, so the UI5 runtime requests the covered modules
 * individually (as their unminified <code>-dbg</code> variant) instead of from a bundle. This
 * middleware then instruments each requested <code>?instrument</code> resource — preferring the
 * unminified <code>-dbg</code> source — and reports it under the runtime path. Bundles (identified
 * by their <code>ui5:IsBundle</code> resource tag) are never instrumented; they are served verbatim
 * by the following middleware.
 *
 * @param {object} parameters Parameters
 * @param {@ui5/logger/Logger} parameters.log
 *      Logger instance for use in the custom middleware.
 *      This parameter is only provided to custom middleware
 * @param {object} parameters.middlewareUtil Specification version dependent interface to a
 * 										[MiddlewareUtil]{https://ui5.github.io/cli/v3/api/@ui5_server_middleware_MiddlewareUtil.html} instance
 * @param {object} parameters.options Options
 * @param {object} [parameters.options.configuration] Custom server middleware configuration if given in ui5.yaml
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
		...generalConfig
	} = config;

	const {version: middlewareVersion} = await readJsonFile(new URL("../package.json", import.meta.url));

	// Instrumenter instance
	const instrumenter = createInstrumenter(instrumenterConfig);
	// Switch callback parameters to match promisify signature
	const callbackStyleInstrumenter = (code, filename, inputSourceMap, callback) =>
		instrumenter.instrument(code, filename, callback, inputSourceMap);
	const instrument = promisify(callbackStyleInstrumenter);

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
		try {
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

			// Only instrument JS resources the client opts into via ?instrument (and which are not excluded).
			if (!shouldInstrumentResource(req, excludePatterns)) {
				next();
				return;
			}

			const pathname = middlewareUtil.getPathname(req);
			log.verbose(`handling ${pathname}...`);

			// Report against the runtime path even when the browser requested the -dbg variant directly
			// (as it does when the page is loaded with sap-ui-debug), so coverage keys line up with what
			// the client selects and what the reporter reads.
			const reportedPath = isDebugPath(pathname) ? fromDebugPath(pathname) : pathname;

			// Prefer the unminified -dbg source for faithful per-line coverage; fall back to the requested
			// resource when no -dbg variant exists (minify task disabled, or the -dbg variant was requested
			// directly).
			let sourcePath;
			let matchedResource;
			if (!isDebugPath(pathname)) {
				sourcePath = toDebugPath(pathname);
				matchedResource = await builtResources.all.byPath(sourcePath);
			}
			if (!matchedResource) {
				sourcePath = pathname;
				matchedResource = await builtResources.all.byPath(pathname);
			}

			if (!matchedResource) {
				log.warn(`${pathname} not found`);
				next();
				return;
			}

			// Never instrument bundles (e.g. *-preload.js): instrumenting the concatenated, minified
			// bundle would corrupt coverage. Bundles are served verbatim by the following middleware;
			// coverage comes from the individual modules the client requests instead (loaded via
			// sap-ui-debug). Detected via the resource's `ui5:IsBundle` tag.
			if (isBundleResource(matchedResource, log)) {
				log.verbose(`${pathname} is a bundle; serving without instrumentation`);
				next();
				return;
			}

			// Feed istanbul the instrumented source's own source map when present (e.g. a TypeScript
			// project's -dbg source mapping back to the original .ts), so coverage is attributed to the
			// original source. Absent a sibling map (plain JS), this is a no-op.
			// Passed as a plain source-map object: UI5 per-module -dbg maps are flat (not indexed), and
			// istanbul expects a plain object — a non-plain instance would be spread-mangled internally.
			// TODO: resolve the map via the source's sourceMappingURL rather than assuming a `.map` sibling.
			const sourceMapResource = await builtResources.all.byPath(`${sourcePath}.map`);
			const inputSourceMap = sourceMapResource ?
				JSON.parse(await sourceMapResource.getString()) :
				undefined;

			sendInstrumented(
				res, await instrument(await matchedResource.getString(), reportedPath, inputSourceMap), reportedPath
			);
		} catch (err) {
			// A reader rejection or an unparseable source (istanbul throwing) must not stall the dev
			// server. Log the cause and defer to the error-handling stack.
			log.error(`Failed to instrument ${req.url}: ${err.message}`);
			if (err.stack) {
				log.verbose(err.stack);
			}
			next(err);
		}
	});

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
