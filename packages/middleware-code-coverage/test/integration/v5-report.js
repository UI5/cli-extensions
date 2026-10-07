import {default as test, registerCompletionHandler} from "ava";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {startServer, extractCoverageData, v5Available} from "./_v5Server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// A served UI5 project keeps the process alive via the child's pipes; force a clean exit once done.
registerCompletionHandler(() => {
	process.exit();
});

// Report-time behaviour against a real build: coverage posted for multiple files is aggregated and
// (for TypeScript) remapped onto the original `.ts`, the generated report is served and renders the
// original source, a configured non-default reporter is exposed, and plain-JS coverage (no input
// source map) is reported under its runtime path unchanged. Requires the v5 CLI; skips when absent.

const LIB_TS = path.join(__dirname, "fixtures", "coverage-lib-ts");
const LIB_TS_CONFIG = path.join(__dirname, "fixtures", "config", "coverage-lib-ts.yaml");
const REPORTERS_CONFIG = path.join(__dirname, "fixtures", "config", "coverage-lib-ts-reporters.yaml");
const DEP_LIB = path.join(__dirname, "fixtures", "coverage-dep-lib");
const DEP_LIB_CONFIG = path.join(__dirname, "fixtures", "config", "coverage-dep-lib.yaml");

const v5test = v5Available ? test.serial : test.serial.skip;

async function serve(t, options) {
	const {app, child} = await startServer(options);
	t.teardown(() => child.kill());
	return app;
}

// Instruments a module and returns the coverage object the browser would collect and POST back.
async function instrumentedCoverage(app, modulePath) {
	const res = await app.get(`${modulePath}?instrument=true`).expect(200);
	return extractCoverageData(res.text);
}

v5test("aggregates coverage for multiple files, each remapped to its .ts, and serves the report", async (t) => {
	t.timeout(TEST_TIMEOUT);
	const app = await serve(t, {
		cwd: LIB_TS,
		config: LIB_TS_CONFIG,
		warmUpPaths: [
			"/resources/covered/lib/Thing.js?instrument=true",
			"/resources/covered/lib/library.js?instrument=true"
		]
	});

	const thing = await instrumentedCoverage(app, "/resources/covered/lib/Thing.js");
	const library = await instrumentedCoverage(app, "/resources/covered/lib/library.js");

	const report = await app
		.post("/.ui5/coverage/report")
		.set("Content-Type", "application/json")
		.send({[thing.path]: thing, [library.path]: library})
		.expect(200);

	t.deepEqual(
		[...report.body.coverageMap].sort(),
		["/resources/covered/lib/Thing.ts", "/resources/covered/lib/library.ts"],
		"both files are aggregated and remapped onto their original .ts"
	);

	// The generated HTML report is served and renders the original TypeScript source.
	const index = await app.get("/.ui5/coverage/report/html/index.html").expect(200);
	t.true(index.text.includes("Thing.ts"), "the report index lists the original .ts source");

	const page = await app.get("/.ui5/coverage/report/html/Thing.ts.html").expect(200);
	t.true(page.text.includes("greet"), "the per-file report renders the original TypeScript source");
});

v5test("exposes and serves a configured non-default reporter", async (t) => {
	t.timeout(TEST_TIMEOUT);
	const app = await serve(t, {
		cwd: LIB_TS,
		config: REPORTERS_CONFIG,
		warmUpPaths: ["/resources/covered/lib/Thing.js?instrument=true"]
	});

	const thing = await instrumentedCoverage(app, "/resources/covered/lib/Thing.js");
	const report = await app
		.post("/.ui5/coverage/report")
		.set("Content-Type", "application/json")
		.send({[thing.path]: thing})
		.expect(200);

	const lcov = report.body.availableReports.find((r) => r.report === "lcovonly");
	t.truthy(lcov, "the configured lcovonly reporter is exposed in availableReports");

	await app.get(`/.ui5/coverage/report/${lcov.destination}`).expect(200);
});

v5test("plain-JS coverage is reported under its runtime path, not remapped", async (t) => {
	t.timeout(TEST_TIMEOUT);
	const app = await serve(t, {
		cwd: DEP_LIB,
		config: DEP_LIB_CONFIG,
		warmUpPaths: ["/resources/covered/dep/Widget.js?instrument=true"]
	});

	const widget = await instrumentedCoverage(app, "/resources/covered/dep/Widget.js");
	t.is(widget.inputSourceMap, undefined, "a plain-JS module carries no input source map");

	const report = await app
		.post("/.ui5/coverage/report")
		.set("Content-Type", "application/json")
		.send({[widget.path]: widget})
		.expect(200);

	t.deepEqual(report.body.coverageMap, ["/resources/covered/dep/Widget.js"],
		"coverage stays keyed to the runtime path (remap is a no-op without a map)");
});
