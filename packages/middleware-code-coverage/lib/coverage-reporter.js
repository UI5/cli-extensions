import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";
import istanbulLibCoverage from "istanbul-lib-coverage";
import {createSourceMapStore} from "istanbul-lib-source-maps";
import path from "node:path";
import {toDebugPath, isDebugPath} from "./util.js";

/**
 * @typedef {object} @ui5/middleware-code-coverage/Coverage
 * @property {string[]} coverageMap
 * @property {object[]} availableReports
 */

/**
 * Reports the coverage
 *
 * Coverage posted by the client is remapped through any input source maps embedded in the coverage
 * data (e.g. a TypeScript project's transpiled sources mapping back to the original <code>.ts</code>)
 * so it is reported against the original source. For files without such a map (plain JS, keyed by the
 * runtime path) the unminified <code>-dbg</code> variant is read from the build output.
 *
 * @param {object} coverageData
 * @param {*} config
 * @param {object} builtResources Readers for accessing the build output
 * @param {module:@ui5/fs.AbstractReader} builtResources.all Reader to access the build output of the
 *  root project and its dependencies
 * @param {module:@ui5/fs.AbstractReader} builtResources.rootProject Reader to access the build output of
 *  the root project
 * @param {module:@ui5/fs.AbstractReader} builtResources.dependencies Reader to access the build output of
 *  the project's dependencies
 * @param {@ui5/logger/Logger} log
 *  Logger instance of the custom middleware instance
 * @returns {@ui5/middleware-code-coverage/Coverage}
 */
export default async function(coverageData, config, builtResources, log) {
	let {coverage: globalCoverageMap, watermarks} = coverageData;

	// For compatibility reasons with the old structure, we need first to check
	// whether the "coverage" property is present in coverageData or use the
	// whole coverageData object (old structure).
	globalCoverageMap = globalCoverageMap || coverageData;

	let coverageMap =
		istanbulLibCoverage.createCoverageMap(globalCoverageMap);
	const reportConfig = {...config.report};

	// Frontend config for watermarks should take precedence if present.
	reportConfig.watermarks = {...reportConfig.watermarks, ...watermarks};

	// Remap coverage through any input source maps embedded in the coverage data (e.g. a TypeScript
	// project's transpiled -dbg source mapping back to the original .ts), so coverage is reported
	// against the original source. This is a no-op for files without an input source map (plain JS),
	// which pass through keyed by their runtime path.
	const sourceMapStore = createSourceMapStore();
	coverageMap = await sourceMapStore.transformCoverage(coverageMap);

	// Get & stash the source for each (possibly remapped) key. For a remapped original (e.g. a .ts)
	// the transpiled build output contains the original source next to its -dbg variant; for un-mapped
	// keys (plain JS, keyed by the runtime path) the unminified -dbg variant is read. Sources are
	// resolved only against the sandboxed `builtResources` reader — never the raw filesystem — because
	// the keys (and the source maps they were remapped through) originate from client-posted coverage
	// data; reading arbitrary paths off disk from that input would be an arbitrary-file-read.
	const coverageSources = await Promise.all(
		Object.keys(coverageMap.data).map(async (key) => {
			let source = "";

			// Prefer the -dbg variant (the original unminified source) over the minified resource at
			// the key itself. This inverts the instrument-time lookup done by the middleware.
			let matchedResource;
			if (!isDebugPath(key)) {
				matchedResource = await builtResources.all.byPath(toDebugPath(key));
			}
			if (!matchedResource) {
				matchedResource = await builtResources.all.byPath(key);
			}

			if (matchedResource) {
				source = await matchedResource.getString();
			} else {
				log.warn(
					`${key} not found! Detailed report can't be generated for that resource!`
				);
			}
			return {key, source};
		})
	).then((sources) =>
		sources.reduce(
			(acc, curElement) => acc.set(curElement.key, curElement.source),
			new Map()
		)
	);

	const reportResults = reportConfig.reporter.reduce((acc, reportType) => {
		// create a context for report generation
		const context = libReport.createContext({
			dir: path.join(config.cwd, reportConfig["report-dir"], reportType),
			watermarks: reportConfig.watermarks,
			coverageMap,
			sourceFinder: (path) => coverageSources.get(path),
		});

		// create an instance of the relevant report class, passing the
		// report name e.g. json/html/html-spa/text
		const report = reports.create(reportType);

		// call execute to synchronously create and write the report to disk
		report.execute(context);

		if (report.lcov) {
			acc.push({report: reportType, destination: [reportType, report.lcov.file].join("/")});
			acc.push({report: "html", destination: [reportType, report.html.subdir].join("/")});
		} else {
			acc.push({report: reportType, destination: [reportType, report.file].join("/")});
		}

		return acc;
	}, []);

	return {
		coverageMap: Object.keys(coverageMap.data),
		availableReports: reportResults
	};
}
