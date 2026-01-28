// @ts-nocheck
import {
	createInstrumentationConfig,
	shouldInstrumentResource,
	getLatestSourceMap,
	readJsonFile,
	getLibraryCoverageExcludePatterns
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
 * @param {string} [parameters.options.configuration] Custom server middleware configuration if given in ui5.yaml
 * @param {object} parameters.resources Resource collections
 * @param {module:@ui5/fs.AbstractReader} parameters.resources.all Reader or Collection to read resources of the
 * 										root project and its dependencies
 * @param {module:@ui5/fs.AbstractReader} parameters.resources.rootProject Reader or Collection to read resources of
 * 										the project the server is started in
 * @param {module:@ui5/fs.AbstractReader} parameters.resources.dependencies Reader or Collection to read resources of
 * 										the projects dependencies
 * @returns {Function} Middleware function to use
 */
export default async function({log, middlewareUtil, options={}, resources}) {
	const config = await createInstrumentationConfig(
		options.configuration,
		resources.all
	);
	const {
		report: reporterConfig,
		instrument: instrumenterConfig,
		...generalConfig
	} = config;

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
				req.body,
				config,
				resources,
				log
			);

			if (reportData) {
				res.json(reportData);
			} else {
				res.err("No report data provided");
			}
		}
	);

	/**
	 * Endpoint to check for middleware existence
	 */
	router.get("/.ui5/coverage/ping", async (req, res) => {
		res.json({
			version: middlewareVersion
		});
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
				excludePatterns = await getLibraryCoverageExcludePatterns(resources.all);
			}
		}

		// Skip files which should not be instrumented
		if (!shouldInstrumentResource(req, excludePatterns)) {
			next();
			return;
		}

		log.verbose(`handling ${req.path}...`);

		const pathname = middlewareUtil.getPathname(req);
		const matchedResource = await resources.all.byPath(pathname);

		if (!matchedResource) {
			log.warn(`${pathname} not found`);
			next();
			return;
		}

		const source = await matchedResource.getString();
		let instrumentedSource = await instrument(source, pathname);

		log.verbose(`...${pathname} instrumented!`);

		// Append sourceMap
		if (instrumenterConfig.produceSourceMap) {
			instrumentedSource += getLatestSourceMap(instrumenter);

			log.verbose(`...${pathname} sourceMap embedded!`);
		}

		// send out instrumented source + source map
		res.type(".js");
		res.end(instrumentedSource);
	});

	return router;
}
