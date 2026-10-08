import {default as test, registerCompletionHandler} from "ava";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {startServer, extractCoverageData} from "./_server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A served UI5 project keeps the process alive via the child's pipes; force a clean exit once done.
registerCompletionHandler(() => {
	process.exit();
});

// The middleware derives its behaviour from what the build produced. These scenarios serve the same
// fixtures with build tasks skipped (via --exclude-task) and assert that coverage stays faithful and
// correctly keyed regardless:
//   - minify emits the unminified `-dbg` variant; without it the middleware falls back to the
//     (already unminified) runtime file.
//   - generate*Preload emits the bundle; the `ui5:IsBundle` guard serves it verbatim when present.
// Each scenario runs its own `ui5 serve` with --cache Off (see _server.js) so the exclude sets do
// not leak across runs.

const APP = path.join(__dirname, "fixtures", "ui5-app");
const LIB = path.join(__dirname, "fixtures", "coverage-lib-ts");
const LIB_CONFIG = path.join(__dirname, "fixtures", "config", "coverage-lib-ts.yaml");

// Application module serves at the root; library module under /resources/<namespace>/.
const APP_MODULE = "/controller/App.controller.js";
const APP_PRELOAD = "/Component-preload.js";
const LIB_MODULE = "/resources/covered/lib/Thing.js";
const LIB_PRELOAD = "/resources/covered/lib/library-preload.js";

// the per-type default preload task.
const APP_BUNDLE_TASK = "generateComponentPreload";
const LIB_BUNDLE_TASK = "generateLibraryPreload";

const scenarios = [
	// Application (plain JS). `formatMessage(message)` is a distinctive unminified marker.
	{
		title: "app · bundle skipped (minify on)",
		cwd: APP, excludeTasks: [APP_BUNDLE_TASK],
		module: APP_MODULE, unminified: "formatMessage(message)"
	},
	{
		title: "app · bundle + minify skipped",
		cwd: APP, excludeTasks: [APP_BUNDLE_TASK, "minify"],
		module: APP_MODULE, unminified: "formatMessage(message)"
	},
	{
		title: "app · minify skipped (bundle on)",
		cwd: APP, excludeTasks: ["minify"],
		module: APP_MODULE, unminified: "formatMessage(message)",
		preload: APP_PRELOAD, preloadVerbatim: true
	},
	// Library (TypeScript). Also asserts the TS input source map survives each config.
	{
		title: "lib · bundle skipped (minify on)",
		cwd: LIB, config: LIB_CONFIG, excludeTasks: [LIB_BUNDLE_TASK], isTs: true,
		module: LIB_MODULE, unminified: "greet(name)"
	},
	{
		title: "lib · bundle + minify skipped",
		cwd: LIB, config: LIB_CONFIG, excludeTasks: [LIB_BUNDLE_TASK, "minify"], isTs: true,
		module: LIB_MODULE, unminified: "greet(name)"
	},
	{
		title: "lib · minify skipped (bundle on)",
		cwd: LIB, config: LIB_CONFIG, excludeTasks: ["minify"], isTs: true,
		module: LIB_MODULE, unminified: "greet(name)",
		preload: LIB_PRELOAD, preloadVerbatim: true
	}
];

for (const s of scenarios) {
	test.serial(s.title, async (t) => {
		const warmUpPaths = [`${s.module}?instrument=true`];
		if (s.preloadVerbatim) {
			warmUpPaths.push(s.preload);
		}
		const {app, child} = await startServer({
			cwd: s.cwd, config: s.config, excludeTasks: s.excludeTasks, warmUpPaths
		});
		t.teardown(() => child.kill());

		// The covered module instruments, keyed to its runtime path, from unminified source — whether
		// that comes from the `-dbg` variant (minify on) or the plain runtime file (minify off).
		const mod = await app.get(`${s.module}?instrument=true`).expect(200);
		t.is(mod.headers["content-type"], "text/javascript");
		t.true(mod.text.includes(`path:"${s.module}"`), "keyed to the runtime path");
		t.true(mod.text.includes("cov_"), "instrumented");
		t.true(mod.text.includes(s.unminified), "instrumented from unminified source");

		// When a preload bundle exists, requesting it with ?instrument serves it verbatim (IsBundle).
		if (s.preloadVerbatim) {
			const pre = await app.get(`${s.preload}?instrument=true`).expect(200);
			t.true(pre.text.startsWith("//@ui5-bundle"), "bundle served verbatim");
			t.false(pre.text.includes("cov_"), "bundle not instrumented");
		}

		// TypeScript: the input source map onto the original .ts is attached regardless of which
		// artifact carried it (Thing-dbg.js.map with minify, Thing.js.map without).
		if (s.isTs) {
			t.deepEqual(extractCoverageData(mod.text).inputSourceMap?.sources, ["Thing.ts"],
				"input source map resolves to the original TypeScript source");
		}
	});
}
