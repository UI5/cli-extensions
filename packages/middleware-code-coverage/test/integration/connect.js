import test from "ava";
import connect from "connect";
import request from "supertest";
import middleware from "../../lib/middleware.js";

const sampleJS = `sap.ui.define([
"sap/ui/core/mvc/Controller",
"sap/m/MessageToast"
], (Controller, MessageToast) => Controller.extend("ui5.sample.controller.App", {

onInit: () => { },

onButtonPress() {
	MessageToast.show(this.getMessage());
},

getMessage() {
	return this.getView().getModel("i18n").getProperty("message");
},

formatMessage(message) {
	return message.toUpperCase();
}
}));`;

const resources = {
	all: {
		byGlob() {
			return [];
		},
		async byPath() {
			return {
				async getString() {
					return sampleJS;
				}
			};
		}
	}
};

const middlewareUtil = {
	getPathname(req) {
		return new URL(req.url, "http://localhost").pathname;
	}
};

const log = {
	verbose() {},
	warn() {},
	error() {}
};

async function createApp(options = {}) {
	const mw = await middleware({log, middlewareUtil, options, resources});
	const app = connect();
	app.use(mw);
	return request(app);
}

test.beforeEach(async (t) => {
	t.context.app = await createApp();
});

const coverageMap = {
	"/resources/Control1.js": {
		path: "/resources/Control1.js",
		statementMap: {},
		fnMap: {},
		branchMap: {},
		s: {},
		f: {},
		b: {}
	}
};

// Case 1: Ping endpoint — exercises the JSON response path of the ping handler
test("Ping endpoint returns 200 JSON with version", async (t) => {
	const res = await t.context.app
		.get("/.ui5/coverage/ping")
		.expect(200);

	t.is(res.headers["content-type"].split(";")[0], "application/json");
	t.truthy(res.body.version);
});

// Case 2: Send coverage report — exercises body-parser + the JSON response path
test("POST report with coverage map returns coverageMap and availableReports", async (t) => {
	const res = await t.context.app
		.post("/.ui5/coverage/report")
		.set("Content-Type", "application/json")
		.send(coverageMap)
		.expect(200);

	t.is(res.headers["content-type"].split(";")[0], "application/json");
	t.true(Array.isArray(res.body.coverageMap));
	t.true(Array.isArray(res.body.availableReports));
	t.true(res.body.availableReports.some((report) => report.report === "html"));
});

// Case 3: Empty body — reportCoverage always returns a (possibly empty) report,
// so the request succeeds with an empty coverage map. The "no report data" 400
// branch is only reachable when reportCoverage returns falsy, which body-parser
// (always providing at least `{}`) prevents at the HTTP level; that branch is
// covered by the unit tests instead.
test("POST report with empty body returns 200 with an empty coverage map", async (t) => {
	const res = await t.context.app
		.post("/.ui5/coverage/report")
		.set("Content-Type", "application/json")
		.send({})
		.expect(200);

	t.true(Array.isArray(res.body.coverageMap));
	t.is(res.body.coverageMap.length, 0);
});

// Case 4: Generated report is served via serve-static (framework-agnostic)
test("Generated report is served after posting coverage data", async (t) => {
	const reportApp = await createApp();
	await reportApp
		.post("/.ui5/coverage/report")
		.set("Content-Type", "application/json")
		.send(coverageMap)
		.expect(200);

	const res = await reportApp
		.get("/.ui5/coverage/report/html/index.html")
		.expect(200);

	t.true(res.text.includes("Code coverage report"));
});

// Case 5: Instrument a .js resource — exercises req.url parsing in
// shouldInstrumentResource and the Content-Type header set on the response
test("GET with ?instrument=true returns instrumented JS with sourceMappingURL", async (t) => {
	const res = await t.context.app
		.get("/resources/lib1/Control1.js?instrument=true")
		.expect(200);

	const contentType = res.headers["content-type"];
	t.is(contentType, "text/javascript");
	t.true(res.text.includes("path=\"/resources/lib1/Control1.js\""));
	t.true(res.text.includes("sourceMappingURL=data:application/json"));
});

// Case 6: Non-instrumented resource falls through to connect's default 404,
// proving the middleware calls next() instead of swallowing unrelated requests
test("Non-instrumented resource falls through to 404", async (t) => {
	await t.context.app
		.get("/resources/lib1/Control1.js")
		.expect(404);

	t.pass();
});
