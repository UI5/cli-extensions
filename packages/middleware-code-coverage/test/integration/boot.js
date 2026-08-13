import test, {registerCompletionHandler} from "ava";
import path from "node:path";
import {fileURLToPath} from "node:url";
import getPort from "get-port";
import request from "supertest";
import {execa} from "execa";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_TIMEOUT = 5 * 60 * 1000; // 5 minutes

const globalCoverageMap = {
	"/resources/Control1.js": {
		"path": "/resources/Control1.js",
		"statementMap": {
			"0": {
				"start": {
					"line": 7,
					"column": 0
				},
				"end": {
					"line": 31,
					"column": 3
				}
			},
			"1": {
				"start": {
					"line": 11,
					"column": 17
				},
				"end": {
					"line": 11,
					"column": 26
				}
			},
			"2": {
				"start": {
					"line": 17,
					"column": 18
				},
				"end": {
					"line": 28,
					"column": 2
				}
			},
			"3": {
				"start": {
					"line": 19,
					"column": 3
				},
				"end": {
					"line": 21,
					"column": 4
				}
			}
		},
		"fnMap": {},
		"branchMap": {},
		"s": {},
		"f": {},
		"b": {}
	}
};

function exec(command, args=[]) {
	return execa(command, args, {
		cwd: path.join(__dirname, "fixtures", "ui5-app"),
		preferLocal: true
	},
	{
		stdout: {file: process.stdout},
		stderr: {file: process.stderr},
	});
}

function startUI5Server(configPath, port) {
	const child = exec("ui5", ["serve", "--config", configPath, "--port", port]);

	registerCompletionHandler(() => {
		process.exit();
	});

	return new Promise( (resolve, reject) => {
		const onError = (errMessage = "Start of UI5 Server failed.") => {
			reject(new Error(errMessage));
		};
		const onSuccess = (data) => {
			data = data ? data.toString() : "";
			if (data.includes("URL: http://localhost:")) {
				resolve();
			} else if (data.includes("Process Failed With Error")) {
				onError();
			}
		};

		child.stdout.on("data", onSuccess);
		child.on("close", onError);
	});
}

async function startUI5App(config = "./ui5.yaml") {
	const configPath = path.resolve(config);
	const port = await getPort();

	await startUI5Server(configPath, port);

	const app = request(`http://localhost:${port}`);
	return {app};
}

test.before(async (t) => {
	t.timeout(TEST_TIMEOUT);

	const {app} = await startUI5App(path.join(__dirname, "fixtures", "config", "ui5-simple.yaml"));
	t.context.app = app;
});

test.serial("Ping endpoint is up and running", async (t) => {
	const {app} = t.context;

	const pingResponse = await app.get("/.ui5/coverage/ping");
	t.is(pingResponse.status, 200, "Ping was successful");
	t.is(pingResponse.type, "application/json", "Content-Type is correct");
	t.truthy(pingResponse.body.version, "Version is valid");
});

test.serial("Send coverage report", async (t) => {
	const {app} = t.context;

	const reportResponse = await app.post("/.ui5/coverage/report", globalCoverageMap);
	t.is(reportResponse.type, "application/json", "Content-Type is correct");

	const responseBody = JSON.parse(reportResponse.res.text);

	t.true(Array.isArray(responseBody.coverageMap), "coverageMap is present and is an array");
	t.true(Array.isArray(responseBody.availableReports), "availableReports is present and is an array");
	t.true(responseBody.availableReports.some((report) => report.report === "html"), "Has HTML report by default");
});

test.serial("Coverage report is generated and available", async (t) => {
	const {app} = t.context;

	await app.post("/.ui5/coverage/report", globalCoverageMap);

	const htmlReportResponse = await app.get("/.ui5/coverage/report/html/index.html");
	t.is(htmlReportResponse.status, 200, "HTML Report is generated and available");
	t.truthy(
		htmlReportResponse.text.includes("<title>Code coverage report"),
		"HTML Report is a real coverage page"
	);
});

test.serial("Coverage report is unavailable", async (t) => {
	const {app} = t.context;

	await app.post("/.ui5/coverage/report", globalCoverageMap);

	const nonExistingReportReportResponse = await app.get("/.ui5/coverage/report/cobertura");
	t.is(nonExistingReportReportResponse.status, 404, "cobertura report has not been generated");
	t.falsy(
		nonExistingReportReportResponse.text.includes("<title>Code coverage report"),
		"A non coverage report page is returned"
	);
});
