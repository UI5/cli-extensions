import {default as test, registerCompletionHandler} from "ava";
import path from "node:path";
import {existsSync} from "node:fs";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import getPort from "get-port";
import request from "supertest";
import {execa} from "execa";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const TEST_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Option C ("sap-ui-debug") produces faithful per-file coverage against the v5 build output. The
// client (the UI5 runtime, loaded with `sap-ui-debug`) requests covered modules individually as
// their unminified `-dbg` variant with `?instrument=true`; the middleware instruments them and
// reports them under the runtime path. This test plays that client role by issuing those requests
// directly against a real server — no browser needed — so it verifies the server-side contract and
// the TypeScript remap end to end.
//
// It requires Specification Version 5.0 (the `builtResources` reader split), which only the v5 CLI
// provides. The repo's default `ui5` is still v4, so the v5 CLI is installed under the npm alias
// `@ui5/cli-next` and spawned by its explicit path here (the `ui5` bin name collides between the two
// majors, so the resolved path — not the bin — is used).

const fixtureDir = path.join(__dirname, "fixtures", "coverage-lib-ts");
const configPath = path.join(__dirname, "fixtures", "config", "coverage-lib-ts.yaml");

// Resolve the v5 CLI binary from the `@ui5/cli-next` alias. Absent (e.g. the alias was not
// installed) -> the whole v5-only suite is skipped rather than failed.
let ui5V5Bin;
try {
	const pkgJson = require.resolve("@ui5/cli-next/package.json");
	ui5V5Bin = path.join(path.dirname(pkgJson), require(pkgJson).bin.ui5);
} catch {
	ui5V5Bin = undefined;
}

function startUI5Server(port) {
	// Spawn the v5 CLI directly via Node (not the colliding `ui5` bin). UI5_CLI_NO_LOCAL stops it
	// from delegating to a project-local CLI install.
	const child = execa(process.execPath, [ui5V5Bin, "serve", "--config", configPath, "--port", port], {
		cwd: fixtureDir,
		env: {...process.env, UI5_CLI_NO_LOCAL: "true"}
	});

	registerCompletionHandler(() => {
		process.exit();
	});

	return new Promise((resolve, reject) => {
		const onError = (errMessage = "Start of UI5 Server failed.") => {
			reject(new Error(errMessage));
		};
		const onData = (data) => {
			data = data ? data.toString() : "";
			if (data.includes("URL: http://localhost:")) {
				// Resolve with a plain wrapper, never the execa subprocess directly: the subprocess
				// is thenable, so resolving with it would make this Promise adopt its state and await
				// the server's *exit* — hanging the caller forever.
				resolve({child});
			} else if (data.includes("Process Failed With Error")) {
				onError(data);
			}
		};
		child.stdout.on("data", onData);
		child.stderr.on("data", onData);
		child.on("close", () => onError());
	});
}

test.before(async (t) => {
	t.timeout(TEST_TIMEOUT);

	if (!ui5V5Bin) {
		return; // handled per-test via the skip guard below
	}

	// The fixture is a standalone project: UI5 resolves its custom middleware/task from the
	// fixture's own node_modules, so it must be installed (CI's root `npm ci` does not reach it).
	// Idempotent: skip when already installed.
	if (!existsSync(path.join(fixtureDir, "node_modules", "@ui5", "middleware-code-coverage"))) {
		await execa("npm", ["install", "--no-audit", "--no-fund"], {cwd: fixtureDir});
	}

	const port = await getPort();
	const {child} = await startUI5Server(port);
	t.context.child = child;
	t.context.app = request(`http://localhost:${port}`);

	// "URL: ..." in the log means the socket is listening, not that the build is ready: the serve
	// pipeline builds each artifact lazily on its first request. Warm up every resource the tests
	// touch (the instrumented module and the preload bundle build independently) with a retrying
	// request so the assertions never race a cold first build (which can yield a malformed response).
	await warmUp(t.context.app, [
		"/resources/covered/lib/Thing.js?instrument=true",
		"/resources/covered/lib/library-preload.js"
	]);
});

async function warmUp(app, paths, attempts = 30) {
	for (const resourcePath of paths) {
		let ready = false;
		for (let i = 0; i < attempts && !ready; i++) {
			try {
				const res = await app.get(resourcePath);
				ready = res.status === 200;
			} catch {
				// server/build not ready yet — retry
			}
			if (!ready) {
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		}
		if (!ready) {
			throw new Error(`UI5 server did not become ready for ${resourcePath} in time`);
		}
	}
}

test.after.always((t) => {
	t.context.child?.kill();
});

// Run only when a v5 CLI is available; otherwise skip (keeps the suite green on the v4 default).
const v5test = ui5V5Bin ? test.serial : test.serial.skip;

// Extracts the istanbul coverage object embedded in an instrumented response, as the browser would
// collect it into `window.__coverage__[path]` and POST back. The embedded literal is plain JS (not
// JSON), so it is evaluated rather than parsed.
function extractCoverageData(instrumentedSource) {
	const match = instrumentedSource.match(/var coverageData=(\{.*?\});var coverage=/s);
	if (!match) {
		throw new Error("Could not locate embedded coverageData in the instrumented response");
	}
	// eslint-disable-next-line no-eval
	return eval(`(${match[1]})`);
}

v5test("A1: -dbg module requested with ?instrument is instrumented and keyed to the runtime path", async (t) => {
	// The exact request the sap-ui-debug client emits for a covered module. No coverage Referer.
	const res = await t.context.app
		.get("/resources/covered/lib/Thing-dbg.js?instrument=true")
		.expect(200);

	t.is(res.headers["content-type"], "text/javascript");
	t.true(res.text.includes(`path:"/resources/covered/lib/Thing.js"`),
		"coverage is keyed to the runtime path, not the -dbg path");
});

v5test("A2/A3: runtime-path request instruments from the unminified -dbg source", async (t) => {
	const res = await t.context.app
		.get("/resources/covered/lib/Thing.js?instrument=true")
		.expect(200);

	t.true(res.text.includes(`path:"/resources/covered/lib/Thing.js"`), "keyed to the runtime path");
	t.true(res.text.includes("greet(name)"), "instrumented from the unminified -dbg source");
	t.false(res.text.includes("greet(e)"), "not the minified runtime artifact");
});

v5test("A4: a bundle requested with ?instrument is served verbatim, never instrumented", async (t) => {
	const res = await t.context.app
		.get("/resources/covered/lib/library-preload.js?instrument=true")
		.expect(200);

	t.true(res.text.startsWith("//@ui5-bundle"), "the original bundle is served");
	t.false(res.text.includes("cov_"), "the bundle carries no instrumentation counters");
});

v5test("C: a resource without ?instrument is left untouched (minified, no counters)", async (t) => {
	const res = await t.context.app
		.get("/resources/covered/lib/Thing.js")
		.expect(200);

	t.false(res.text.includes("cov_"), "not instrumented");
	t.true(res.text.includes("greet(e)"), "served as the minified runtime artifact");
});

v5test("B: TypeScript coverage is remapped onto the original .ts at report time", async (t) => {
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
