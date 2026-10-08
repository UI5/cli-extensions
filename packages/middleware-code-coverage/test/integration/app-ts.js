import {default as test, registerCompletionHandler} from "ava";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {startServer, extractCoverageData} from "./_server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A served UI5 project keeps the process alive via the child's pipes; force a clean exit once done.
registerCompletionHandler(() => {
	process.exit();
});

// TypeScript support is not limited to libraries: an application's transpiled modules are likewise
// instrumented from the unminified source and their coverage remapped onto the original `.ts`.

const APP_TS = path.join(__dirname, "fixtures", "coverage-app-ts");
const MODULE = "/util/Formatter.js";

test.before(async (t) => {
	const {app, child} = await startServer({cwd: APP_TS, warmUpPaths: [`${MODULE}?instrument=true`]});
	t.context.app = app;
	t.context.child = child;
});

test.after.always((t) => {
	t.context.child?.kill();
});

test.serial("instruments a transpiled application module and attaches its .ts input source map", async (t) => {
	const res = await t.context.app
		.get(`${MODULE}?instrument=true`)
		.expect(200);

	t.true(res.text.includes(`path:"${MODULE}"`), "keyed to the runtime path");
	t.true(res.text.includes("cov_"), "instrumented");
	t.deepEqual(extractCoverageData(res.text).inputSourceMap?.sources, ["Formatter.ts"],
		"the transpiled application module carries its .ts input source map");
});

test.serial("remaps application TypeScript coverage onto the original .ts at report time", async (t) => {
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
