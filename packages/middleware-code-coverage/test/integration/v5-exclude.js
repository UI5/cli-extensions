import {default as test, registerCompletionHandler} from "ava";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {startServer, v5Available} from "./_v5Server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// A served UI5 project keeps the process alive via the child's pipes; force a clean exit once done.
registerCompletionHandler(() => {
	process.exit();
});

// Coverage can be suppressed per resource two ways: the middleware's `excludePatterns` configuration,
// and a library's `.library` jscoverage `<exclude>` entries. Both are verified end to end against a
// real build — an excluded module is served but NOT instrumented, while a non-excluded one still is.
// Requires the v5 CLI; skips when absent.

const LIB_TS = path.join(__dirname, "fixtures", "coverage-lib-ts");
const EXCLUDE_CONFIG = path.join(__dirname, "fixtures", "config", "coverage-lib-ts-exclude.yaml");
const DEP_LIB = path.join(__dirname, "fixtures", "coverage-dep-lib");
const DEP_LIB_CONFIG = path.join(__dirname, "fixtures", "config", "coverage-dep-lib.yaml");

const v5test = v5Available ? test.serial : test.serial.skip;

async function serve(t, options) {
	const {app, child} = await startServer(options);
	t.teardown(() => child.kill());
	return app;
}

v5test("excludePatterns config: a matched module is served but not instrumented", async (t) => {
	t.timeout(TEST_TIMEOUT);
	// `Thing.js` matches the configured excludePatterns; `library.js` does not.
	const app = await serve(t, {
		cwd: LIB_TS,
		config: EXCLUDE_CONFIG,
		warmUpPaths: ["/resources/covered/lib/library.js?instrument=true"]
	});

	const excluded = await app.get("/resources/covered/lib/Thing.js?instrument=true").expect(200);
	t.false(excluded.text.includes("cov_"), "the excluded module is served without instrumentation");

	const included = await app.get("/resources/covered/lib/library.js?instrument=true").expect(200);
	t.true(included.text.includes("cov_"), "a non-excluded module is still instrumented");
});

v5test(".library excludes: a jscoverage-excluded module is served but not instrumented", async (t) => {
	t.timeout(TEST_TIMEOUT);
	// covered.dep's .library excludes `Helper` via <jscoverage><exclude>; `Widget` is not excluded.
	const app = await serve(t, {
		cwd: DEP_LIB,
		config: DEP_LIB_CONFIG,
		warmUpPaths: ["/resources/covered/dep/Widget.js?instrument=true"]
	});

	const excluded = await app.get("/resources/covered/dep/Helper.js?instrument=true").expect(200);
	t.false(excluded.text.includes("cov_"), "the .library-excluded module is served without instrumentation");

	const included = await app.get("/resources/covered/dep/Widget.js?instrument=true").expect(200);
	t.true(included.text.includes("cov_"), "a non-excluded module is still instrumented");
});
