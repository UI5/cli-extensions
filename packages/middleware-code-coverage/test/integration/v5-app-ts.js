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

// TypeScript support is not limited to libraries: an application's transpiled modules are likewise
// instrumented from the unminified source and their coverage remapped onto the original `.ts`.
// Requires the v5 CLI; skips when absent.

const APP_TS = path.join(__dirname, "fixtures", "coverage-app-ts");
const MODULE = "/util/Formatter.js";

test.before(async (t) => {
	t.timeout(TEST_TIMEOUT);
	if (!v5Available) {
		return;
	}
	const {app, child} = await startServer({cwd: APP_TS, warmUpPaths: [`${MODULE}?instrument=true`]});
	t.context.app = app;
	t.context.child = child;
});

test.after.always((t) => {
	t.context.child?.kill();
});

const v5test = v5Available ? test.serial : test.serial.skip;

v5test("instruments a transpiled application module and attaches its .ts input source map", async (t) => {
	const res = await t.context.app
		.get(`${MODULE}?instrument=true`)
		.expect(200);

	t.true(res.text.includes(`path:"${MODULE}"`), "keyed to the runtime path");
	t.true(res.text.includes("cov_"), "instrumented");
	t.deepEqual(extractCoverageData(res.text).inputSourceMap?.sources, ["Formatter.ts"],
		"the transpiled application module carries its .ts input source map");
});

v5test("remaps application TypeScript coverage onto the original .ts at report time", async (t) => {
	const instrumented = await t.context.app.get(`${MODULE}?instrument=true`).expect(200);
	const coverageData = extractCoverageData(instrumented.text);

	const report = await t.context.app
		.post("/.ui5/coverage/report")
		.set("Content-Type", "application/json")
		.send({[coverageData.path]: coverageData})
		.expect(200);

	t.true(report.body.coverageMap.includes("/util/Formatter.ts"),
		"coverage was remapped from the transpiled JS onto the original TypeScript source");
});
