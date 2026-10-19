import {default as test, registerCompletionHandler} from "ava";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {startServer, extractCoverageData} from "./_server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A served UI5 project keeps the process alive via the child's pipes; force a clean exit once done.
registerCompletionHandler(() => {
	process.exit();
});

// Verifies the coverage middleware's server-side contract against a real v5 build (where it reads
// the build output via `builtResources`): a `?instrument` request for a module returns instrumented
// code keyed to the module's runtime path, built from the unminified `-dbg` source when present;
// bundles are served verbatim; and TypeScript coverage is remapped onto the original `.ts` at report
// time. Requests are issued directly against the server — no browser — exercising the middleware end
// to end. The server is started via _server.js.

const fixtureDir = path.join(__dirname, "fixtures", "coverage-lib-ts");
const configPath = path.join(__dirname, "fixtures", "config", "coverage-lib-ts.yaml");

test.before(async (t) => {
	const {app, child} = await startServer({
		cwd: fixtureDir,
		config: configPath,
		warmUpPaths: [
			"/resources/covered/lib/Thing.js?instrument=true",
			"/resources/covered/lib/library-preload.js"
		]
	});
	t.context.app = app;
	t.context.child = child;
});

test.after.always((t) => {
	t.context.child?.kill();
});

test.serial("instruments a -dbg module and keys coverage to the runtime path", async (t) => {
	// The exact request the runtime emits for a covered module loaded un-bundled.
	const res = await t.context.app
		.get("/resources/covered/lib/Thing-dbg.js?instrument=true")
		.expect(200);

	t.is(res.headers["content-type"], "text/javascript");
	t.true(res.text.includes(`path:"/resources/covered/lib/Thing.js"`),
		"coverage is keyed to the runtime path, not the -dbg path");
});

test.serial("instruments a runtime-path request from the unminified -dbg source", async (t) => {
	const res = await t.context.app
		.get("/resources/covered/lib/Thing.js?instrument=true")
		.expect(200);

	t.true(res.text.includes(`path:"/resources/covered/lib/Thing.js"`), "keyed to the runtime path");
	t.true(res.text.includes("greet(name)"), "instrumented from the unminified -dbg source");
	t.false(res.text.includes("greet(e)"), "not the minified runtime artifact");
});

test.serial("serves a bundle requested with ?instrument verbatim, never instrumented", async (t) => {
	const res = await t.context.app
		.get("/resources/covered/lib/library-preload.js?instrument=true")
		.expect(200);

	t.true(res.text.startsWith("//@ui5-bundle"), "the original bundle is served");
	t.false(res.text.includes("cov_"), "the bundle carries no instrumentation counters");
});

test.serial("leaves a resource without ?instrument untouched (minified, no counters)", async (t) => {
	const res = await t.context.app
		.get("/resources/covered/lib/Thing.js")
		.expect(200);

	t.false(res.text.includes("cov_"), "not instrumented");
	t.true(res.text.includes("greet(e)"), "served as the minified runtime artifact");
});

test.serial("remaps TypeScript coverage onto the original .ts at report time", async (t) => {
	// Instrument the module, collect the coverage object the client would post (carrying the
	// input source map), and report it back.
	const instrumented = await t.context.app
		.get("/resources/covered/lib/Thing.js?instrument=true")
		.expect(200);
	const coverageData = extractCoverageData(instrumented.text);

	t.deepEqual(coverageData.inputSourceMap?.sources, ["Thing.ts"],
		"the -dbg -> .ts input source map is embedded in the coverage data");

	const report = await t.context.app
		.post("/.ui5/coverage/report")
		.set("Content-Type", "application/json")
		.send({[coverageData.path]: coverageData})
		.expect(200);

	t.true(report.body.coverageMap.includes("/resources/covered/lib/Thing.ts"),
		"coverage was remapped from the transpiled JS onto the original TypeScript source");
});
