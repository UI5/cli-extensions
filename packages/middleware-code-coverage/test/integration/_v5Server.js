import path from "node:path";
import {existsSync} from "node:fs";
import {createRequire} from "node:module";
import getPort from "get-port";
import request from "supertest";
import {execa} from "execa";

const require = createRequire(import.meta.url);

// Resolve the v5 CLI from the `@ui5/cli-next` alias (v5 installed alongside the repo's v4). Resolved
// by its explicit path because the `ui5` bin name collides between the two majors. Absent (alias not
// installed) -> `v5Available` is false and the v5-only suites skip rather than fail.
let ui5V5Bin;
try {
	const pkgJson = require.resolve("@ui5/cli-next/package.json");
	ui5V5Bin = path.join(path.dirname(pkgJson), require(pkgJson).bin.ui5);
} catch {
	ui5V5Bin = undefined;
}

export {ui5V5Bin};
export const v5Available = Boolean(ui5V5Bin);

// A standalone fixture resolves its custom middleware/task from its own node_modules, which CI's root
// `npm ci` does not reach. Install on demand; idempotent.
async function ensureFixtureInstalled(cwd) {
	if (!existsSync(path.join(cwd, "node_modules", "@ui5", "middleware-code-coverage"))) {
		await execa("npm", ["install", "--no-audit", "--no-fund"], {cwd});
	}
}

// Warm up every resource the test will touch. "URL: ..." means the socket is listening, not that the
// build is ready: the serve pipeline builds each artifact lazily on first request. Only warm paths
// that are expected to exist (a 404 path — e.g. a bundle skipped via --exclude-task — would never
// reach 200). Retries so assertions never race a cold first build (which can yield a malformed body).
async function warmUp(app, paths, attempts = 30) {
	for (const resourcePath of paths) {
		let ready = false;
		for (let i = 0; i < attempts && !ready; i++) {
			try {
				ready = (await app.get(resourcePath)).status === 200;
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

/**
 * Starts a real v5 `ui5 serve` for a fixture and returns a supertest agent plus the child process.
 *
 * @param {object} options Options
 * @param {string} options.cwd Fixture directory to serve
 * @param {string} [options.config] Path to a ui5.yaml to use instead of the fixture's own
 * @param {string[]} [options.excludeTasks] Build tasks to skip (passed as `--exclude-task`)
 * @param {string[]} [options.warmUpPaths] Resource paths (expected to 200) to pre-build before returning
 * @returns {Promise<{app: object, child: object}>} supertest agent and the server child process
 */
export async function startServer({cwd, config, excludeTasks = [], warmUpPaths = []}) {
	await ensureFixtureInstalled(cwd);

	const port = await getPort();
	// `--cache Off` forces a fresh in-memory build every time: scenarios serve the same fixture with
	// different `--exclude-task` sets, and the on-disk build cache (~/.ui5/buildCache) would otherwise
	// serve a prior scenario's artifacts.
	const args = [ui5V5Bin, "serve", "--cache", "Off", "--port", String(port)];
	if (config) {
		args.push("--config", config);
	}
	if (excludeTasks.length) {
		args.push("--exclude-task", ...excludeTasks);
	}

	// Spawn the v5 CLI via Node directly (not the colliding `ui5` bin). UI5_CLI_NO_LOCAL stops it from
	// delegating to a project-local CLI install. `reject: false` so killing the server in teardown
	// resolves instead of surfacing an unhandled SIGTERM rejection.
	const child = execa(process.execPath, args, {
		cwd,
		env: {...process.env, UI5_CLI_NO_LOCAL: "true"},
		reject: false
	});

	await new Promise((resolve, reject) => {
		const onData = (data) => {
			data = data ? data.toString() : "";
			if (data.includes("URL: http://localhost:")) {
				// Resolve with no value — never the execa subprocess (it is thenable, so resolving with
				// it would make this Promise adopt its state and await the server's exit).
				resolve();
			} else if (data.includes("Process Failed With Error") || data.includes("Command Failed")) {
				reject(new Error(data));
			}
		};
		child.stdout.on("data", onData);
		child.stderr.on("data", onData);
		child.on("close", () => reject(new Error("UI5 server exited before becoming ready")));
	});

	const app = request(`http://localhost:${port}`);
	await warmUp(app, warmUpPaths);
	return {app, child};
}

// Extracts the istanbul coverage object embedded in an instrumented response, as the browser would
// collect it into `window.__coverage__[path]` and POST back. The embedded literal is plain JS (not
// JSON), so it is evaluated rather than parsed.
export function extractCoverageData(instrumentedSource) {
	const match = instrumentedSource.match(/var coverageData=(\{.*?\});var coverage=/s);
	if (!match) {
		throw new Error("Could not locate embedded coverageData in the instrumented response");
	}
	// eslint-disable-next-line no-eval
	return eval(`(${match[1]})`);
}
