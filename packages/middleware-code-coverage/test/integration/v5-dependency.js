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

// Coverage is produced not only for the root project's own modules but for modules served from a
// dependency — the v5 reader split exposes dependency build output via builtResources.dependencies.
// `coverage-dep-app` depends on the plain-JS library `covered.dep`; this instruments a module that
// lives in that dependency. Requires the v5 CLI; skips when absent.

const APP = path.join(__dirname, "fixtures", "coverage-dep-app");
const DEP_MODULE = "/resources/covered/dep/Widget.js";
const APP_MODULE = "/Component.js";

test.before(async (t) => {
	t.timeout(TEST_TIMEOUT);
	if (!v5Available) {
		return;
	}
	const {app, child} = await startServer({
		cwd: APP,
		warmUpPaths: [`${DEP_MODULE}?instrument=true`]
	});
	t.context.app = app;
	t.context.child = child;
});

test.after.always((t) => {
	t.context.child?.kill();
});

const v5test = v5Available ? test.serial : test.serial.skip;

v5test("a dependency's module is instrumented, keyed to its runtime path", async (t) => {
	const res = await t.context.app
		.get(`${DEP_MODULE}?instrument=true`)
		.expect(200);

	t.is(res.headers["content-type"], "text/javascript");
	t.true(res.text.includes(`path:"${DEP_MODULE}"`), "keyed to the dependency's runtime path");
	t.true(res.text.includes("cov_"), "instrumented");
	t.true(res.text.includes("label(text)"), "from the unminified -dbg source of the dependency");
});

v5test("the root project's own module is also instrumented", async (t) => {
	// Control: coverage works for the root project alongside its dependency.
	const res = await t.context.app
		.get(`${APP_MODULE}?instrument=true`)
		.expect(200);

	t.true(res.text.includes(`path:"${APP_MODULE}"`), "keyed to the root project's runtime path");
	t.true(res.text.includes("cov_"), "instrumented");
});
