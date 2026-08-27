import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";
import istanbulLibCoverage from "istanbul-lib-coverage";
import path from "node:path";

/**
 * @typedef {object} @ui5/middleware-code-coverage/Coverage
 * @property {string[]} coverageMap
 * @property {object[]} availableReports
 */

/**
 * Reports the coverage
 *
 * In bundle-instrumentation mode every file of a bundle is instrumented, so the client is
 * responsible for trimming <code>window.__coverage__</code> down to the files of interest (e.g.
 * honoring <code>data-sap-ui-cover-only</code> / <code>data-sap-ui-cover-never</code>) before
 * POSTing it. The reporter therefore reports exactly the coverage keys it receives.
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

	const coverageMap =
		istanbulLibCoverage.createCoverageMap(globalCoverageMap);
	const reportConfig = {...config.report};

	// Frontend config for watermarks should take precedence if present.
	reportConfig.watermarks = {...reportConfig.watermarks, ...watermarks};

	// Get & stash code from the resources
	// Later this would be needed to create the reports
	const coverageSources = await Promise.all(
		Object.keys(coverageMap.data).map(async (key) => {
			let source = "";

			const matchedResource = await builtResources.all.byPath(key);

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
