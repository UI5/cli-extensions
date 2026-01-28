import test from "ava";
import sinon from "sinon";
import esmock from "esmock";

// Node.js itself tries to parse sourceMappingURLs in all JavaScript files. This is unwanted and might even lead to
// obscure errors when dynamically generating Data-URI soruceMappingURL values.
// Therefore use this constant to never write the actual string.
const SOURCE_MAPPING_URL = "//" + "# sourceMappingURL";

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
	getPathname() {
		return "/resources/lib1/Control1.js";
	}
};

test.beforeEach(async (t) => {
	t.context.readJsonFile = sinon.stub().resolves({version: "0.0.0-test"});
	t.context.instrumenterMiddleware = await esmock("../../../lib/middleware.js", {
		"../../../lib/util.js": {
			readJsonFile: t.context.readJsonFile
		}
	});
});

test("Ping request", async (t) => {
	const {instrumenterMiddleware, readJsonFile} = t.context;
	const middleware = await instrumenterMiddleware({resources});

	t.plan(6);

	t.is(readJsonFile.callCount, 1, "package.json should be read once during middleware initialization");
	t.deepEqual(readJsonFile.getCall(0).args, [new URL("../../../package.json", import.meta.url)]);

	await new Promise((resolve) => {
		const res = {
			json: function(body) {
				t.is(Object.keys(body).length, 1);
				t.is(Object.keys(body)[0], "version");
				t.is(body.version, "0.0.0-test", "The version is returned");
				t.is(readJsonFile.callCount, 1, "package.json should not be read again per request");
				resolve();
			}
		};
		const next = function() {
			t.fail("should not be called.");
			resolve();
		};
		middleware({method: "GET", url: "/.ui5/coverage/ping"}, res, next);
	});
});

test("Coverage report request", async (t) => {
	const reportCoverageStub = sinon.stub();
	const log = sinon.stub();
	const coverageData = {
		a: "b"
	};
	const expectedCoverageReport = {c: "d"};
	const instrumenterMiddleware = await esmock("../../../lib/middleware.js", {
		"../../../lib/coverage-reporter.js": reportCoverageStub.returns(expectedCoverageReport)
	});
	const middleware = await instrumenterMiddleware({log, resources});

	t.plan(7);

	await new Promise((resolve) => {
		const res = {
			json(body) {
				t.is(reportCoverageStub.callCount, 1);
				t.is(reportCoverageStub.getCall(0).args.length, 4);
				t.is(reportCoverageStub.getCall(0).args[0], coverageData);
				t.is(reportCoverageStub.getCall(0).args[1].cwd, "./");
				t.is(reportCoverageStub.getCall(0).args[2], resources);
				t.is(reportCoverageStub.getCall(0).args[3], log);
				t.is(body, expectedCoverageReport);
				resolve();
			},
			err() {
				t.fail("should not be called.");
				resolve();
			}
		};
		const next = () => {
			t.fail("should not be called.");
			resolve();
		};
		middleware({
			method: "POST",
			url: "/.ui5/coverage/report",
			headers: {
				type: "application/json"
			},
			body: coverageData
		}, res, next);
	});
});

test("Coverage report request: no report data", async (t) => {
	const reportCoverageStub = sinon.stub();
	const log = sinon.stub();
	const instrumenterMiddleware = await esmock("../../../lib/middleware.js", {
		"../../../lib/coverage-reporter.js": reportCoverageStub.returns(undefined)
	});
	const coverageData = {
		a: "b"
	};
	const middleware = await instrumenterMiddleware({log, resources});

	t.plan(2);

	await new Promise((resolve) => {
		const res = {
			json() {
				t.fail("should not be called.");
				resolve();
			},
			err(message) {
				t.is(reportCoverageStub.callCount, 1);
				t.is(message, "No report data provided");
				resolve();
			}
		};
		const next = () => {
			t.fail("should not be called.");
			resolve();
		};
		middleware({
			method: "POST",
			url: "/.ui5/coverage/report",
			headers: {
				type: "application/json"
			},
			body: coverageData
		}, res, next);
	});
});

test("Consume Coverage report request", async (t) => {
	const serveStaticStub = sinon.stub();
	const instrumenterMiddleware = await esmock.p("../../../lib/middleware.js", {
		"serve-static": () => serveStaticStub
	});
	const middleware = await instrumenterMiddleware({resources});

	t.plan(1);

	const next = () => {
		t.fail("should not be called.");
	};

	middleware({
		method: "GET",
		url: "/.ui5/coverage/report/html"
	}, next, next);

	t.is(serveStaticStub.callCount, 1);
	esmock.purge(instrumenterMiddleware);
});

test("Instrument resources request with source map", async (t) => {
	const log = {
		verbose: sinon.stub()
	};
	const {instrumenterMiddleware} = t.context;
	const middleware = await instrumenterMiddleware({log, middlewareUtil, resources});

	t.plan(4);

	await new Promise((resolve) => {
		const res = {
			end(resource) {
				t.true(resource.includes("path=\"/resources/lib1/Control1.js\""), "Instrumented resource is correct");
				t.true(resource.includes(
					`${SOURCE_MAPPING_URL}=data:application/json;charset=utf-8;base64,`,
					"Instrumented resource contains source map"
				));
				t.is(log.verbose.callCount, 3);
				resolve();
			},
			type(type) {
				t.is(type, ".js");
			}
		};
		const next = () => {
			t.fail("should not be called.");
			resolve();
		};
		middleware({
			method: "GET",
			url: "/resources/lib1/Control1.js",
			path: "/resources/lib1/Control1.js",
			query: {
				instrument: "true"
			}
		}, res, next);
	});
});

test("Instrument resources request with source map: manual enablement", async (t) => {
	const log = {
		verbose: sinon.stub()
	};
	const {instrumenterMiddleware} = t.context;
	const options = {configuration: {instrument: {produceSourceMap: true}}};
	const middleware = await instrumenterMiddleware({log, middlewareUtil, options, resources});

	t.plan(4);

	await new Promise((resolve) => {
		const res = {
			end(resource) {
				t.true(resource.includes("path=\"/resources/lib1/Control1.js\""), "Instrumented resource is correct");
				t.true(resource.includes(
					`${SOURCE_MAPPING_URL}=data:application/json;charset=utf-8;base64,`,
					"Instrumented resource contains source map"
				));
				t.is(log.verbose.callCount, 3);
				resolve();
			},
			type(type) {
				t.is(type, ".js");
			}
		};
		const next = () => {
			t.fail("should not be called.");
			resolve();
		};
		middleware({
			method: "GET",
			url: "/resources/lib1/Control1.js",
			path: "/resources/lib1/Control1.js",
			query: {
				instrument: "true"
			}
		}, res, next);
	});
});

test("Instrument resources request without source map", async (t) => {
	const log = {
		verbose: sinon.stub(),
		warn: sinon.stub()
	};
	const {instrumenterMiddleware} = t.context;
	const options = {configuration: {instrument: {produceSourceMap: false}}};
	const middleware = await instrumenterMiddleware({log, middlewareUtil, options, resources});

	t.plan(4);

	await new Promise((resolve) => {
		const res = {
			end(resource) {
				t.true(resource.includes("path=\"/resources/lib1/Control1.js\""), "Instrumented resource is correct");
				t.false(resource.includes(
					`${SOURCE_MAPPING_URL}=data:application/json;charset=utf-8;base64,`,
					"Instrumented resource contains no source map"
				));
				t.is(log.verbose.callCount, 2);
				resolve();
			},
			type(type) {
				t.is(type, ".js");
			}
		};
		const next = () => {
			t.fail("should not be called.");
			resolve();
		};
		middleware({
			method: "GET",
			url: "/resources/lib1/Control1.js",
			path: "/resources/lib1/Control1.js",
			query: {
				instrument: "true"
			}
		}, res, next);
	});
});

test("Instrument resources request for non instrumented resource", async (t) => {
	const shouldInstrumentResourceStub = sinon.stub().returns(false);
	const log = {};
	const instrumenterMiddleware = await esmock("../../../lib/middleware.js", {
		"../../../lib/util.js": {
			shouldInstrumentResource: shouldInstrumentResourceStub
		}
	});
	const middleware = await instrumenterMiddleware({log, middlewareUtil, resources});

	t.plan(2);

	await new Promise((resolve) => {
		const res = {
			end() {
				t.fail("should not be called.");
				resolve();
			},
			type() {
				t.fail("should not be called.");
				resolve();
			}
		};
		const next = (error) => {
			if (error) {
				t.fail(error);
			} else {
				t.pass("Should be called without error.");
			}
			t.is(shouldInstrumentResourceStub.callCount, 1);
			resolve();
		};
		middleware({
			method: "GET",
			url: "/resources/lib1/Control1.js",
			path: "/resources/lib1/Control1.js",
			query: {
				instrument: "true"
			}
		}, res, next);
	});
});

test("Instrument resources request with no matching resources", async (t) => {
	const log = {
		verbose: sinon.stub(),
		warn: sinon.stub()
	};
	const resources = {
		all: {
			byGlob() {
				return [];
			},
			async byPath() {
				return undefined;
			}
		}
	};
	const {instrumenterMiddleware} = t.context;
	const middleware = await instrumenterMiddleware({log, middlewareUtil, resources});

	t.plan(3);

	await new Promise((resolve) => {
		const res = {
			end() {
				t.fail("should not be called.");
				resolve();
			},
			type() {
				t.fail("should not be called.");
				resolve();
			}
		};
		const next = (error) => {
			if (error) {
				t.fail(error);
			} else {
				t.pass("Should be called without error.");
			}
			t.is(log.verbose.callCount, 1);
			t.is(log.warn.callCount, 1);
			resolve();
		};
		middleware({
			method: "GET",
			url: "/resources/lib1/Control1.js",
			path: "/resources/lib1/Control1.js",
			query: {
				instrument: "true"
			}
		}, res, next);
	});
});

test("Instrument resources request with custom excludePatterns from configuration", async (t) => {
	const log = {
		verbose: sinon.stub()
	};
	const customResources = {
		all: {
			byGlob() {
				return []; // No .library files
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
	const options = {
		configuration: {
			excludePatterns: [
				"/resources/lib1/Control1.js"
			]
		}
	};
	const {instrumenterMiddleware} = t.context;
	const middleware = await instrumenterMiddleware({log, middlewareUtil, options, resources: customResources});

	t.plan(2);

	await new Promise((resolve) => {
		const res = {
			end() {
				t.fail("should not be called because resource is excluded.");
				resolve();
			},
			type() {
				t.fail("should not be called because resource is excluded.");
				resolve();
			}
		};
		const next = (error) => {
			if (error) {
				t.fail(String(error));
			} else {
				t.pass("Should be called without error because resource is excluded via custom excludePatterns.");
			}
			t.is(log.verbose.callCount, 0, "verbose should not be called for excluded resources");
			resolve();
		};
		middleware({
			method: "GET",
			url: "/resources/lib1/Control1.js",
			path: "/resources/lib1/Control1.js",
			query: {
				instrument: "true"
			}
		}, res, next);
	});
});

test("Instrument resources request with custom excludePatterns overrides .library excludes", async (t) => {
	const log = {
		verbose: sinon.stub()
	};
	const sDotLibrary = `<?xml version="1.0" encoding="UTF-8" ?>
<library xmlns="http://www.sap.com/sap.ui.library.xsd" >
	<name>ui5.lib1</name>
	<appData>
		<jscoverage xmlns="http://www.sap.com/ui5/buildext/jscoverage" >
			<exclude name="ui5.lib1.ShouldNotExclude" />
		</jscoverage>
	</appData>
</library>`;

	const customResources = {
		all: {
			byGlob() {
				return [{
					getString() {
						return sDotLibrary;
					}
				}];
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
	const options = {
		configuration: {
			excludePatterns: [
				"/resources/lib1/Control1.js"
			]
		}
	};
	const {instrumenterMiddleware} = t.context;
	const middleware = await instrumenterMiddleware({log, middlewareUtil, options, resources: customResources});

	t.plan(2);

	await new Promise((resolve) => {
		const res = {
			end() {
				t.fail("should not be called because resource is excluded by custom pattern.");
				resolve();
			},
			type() {
				t.fail("should not be called because resource is excluded by custom pattern.");
				resolve();
			}
		};
		const next = (error) => {
			if (error) {
				t.fail(error);
			} else {
				t.pass("Should be called without error - custom excludePatterns override .library excludes.");
			}
			t.is(log.verbose.callCount, 0, "verbose should not be called for excluded resources");
			resolve();
		};
		middleware({
			method: "GET",
			url: "/resources/lib1/Control1.js",
			path: "/resources/lib1/Control1.js",
			query: {
				instrument: "true"
			}
		}, res, next);
	});
});

test("Instrument multiple JS files in sequence", async (t) => {
	const log = {
		verbose: sinon.stub()
	};
	const sampleJS2 = `sap.ui.define(["sap/ui/core/Control"], (Control) => Control.extend("ui5.sample.Control2", {
		renderer: {
			render(oRm, oControl) {
				oRm.write("<div>Control2</div>");
			}
		}
	}));`;

	const customResources = {
		all: {
			byGlob() {
				return [];
			},
			async byPath(path) {
				if (path === "/resources/lib1/Control1.js") {
					return {
						async getString() {
							return sampleJS;
						}
					};
				} else if (path === "/resources/lib2/Control2.js") {
					return {
						async getString() {
							return sampleJS2;
						}
					};
				}
				return undefined;
			}
		}
	};

	const customMiddlewareUtil = {
		getPathname(req) {
			return req.path;
		}
	};

	const {instrumenterMiddleware} = t.context;
	const middleware = await instrumenterMiddleware({
		log,
		middlewareUtil: customMiddlewareUtil,
		resources: customResources
	});

	t.plan(7);

	// First request for Control1.js
	await new Promise((resolve) => {
		const res = {
			end(resource) {
				t.true(resource.includes("path=\"/resources/lib1/Control1.js\""),
					"First instrumented resource is correct");
				t.true(resource.includes(
					`${SOURCE_MAPPING_URL}=data:application/json;charset=utf-8;base64,`
				), "First instrumented resource contains source map");
				resolve();
			},
			type(type) {
				t.is(type, ".js");
			}
		};
		const next = () => {
			t.fail("should not be called.");
			resolve();
		};
		middleware({
			method: "GET",
			url: "/resources/lib1/Control1.js",
			path: "/resources/lib1/Control1.js",
			query: {
				instrument: "true"
			}
		}, res, next);
	});

	// Second request for Control2.js
	await new Promise((resolve) => {
		const res = {
			end(resource) {
				t.true(resource.includes("path=\"/resources/lib2/Control2.js\""),
					"Second instrumented resource is correct");
				t.true(resource.includes(
					`${SOURCE_MAPPING_URL}=data:application/json;charset=utf-8;base64,`
				), "Second instrumented resource contains source map");
				resolve();
			},
			type(type) {
				t.is(type, ".js");
			}
		};
		const next = () => {
			t.fail("should not be called.");
			resolve();
		};
		middleware({
			method: "GET",
			url: "/resources/lib2/Control2.js",
			path: "/resources/lib2/Control2.js",
			query: {
				instrument: "true"
			}
		}, res, next);
	});

	// Verify verbose was called for both requests
	t.is(log.verbose.callCount, 6, "verbose should be called 3 times per instrumented resource");
});

test("Instrument resources request with excludePatterns set to null", async (t) => {
	const log = {
		verbose: sinon.stub()
	};
	const {instrumenterMiddleware} = t.context;
	const options = {
		configuration: {
			excludePatterns: null
		}
	};
	const middleware = await instrumenterMiddleware({log, middlewareUtil, options, resources});

	t.plan(4);

	await new Promise((resolve) => {
		const res = {
			end(resource) {
				t.true(resource.includes("path=\"/resources/lib1/Control1.js\""),
					"Instrumented resource is correct");
				t.true(resource.includes(
					`${SOURCE_MAPPING_URL}=data:application/json;charset=utf-8;base64,`
				), "Instrumented resource contains source map");
				t.is(log.verbose.callCount, 3, "verbose should be called normally");
				resolve();
			},
			type(type) {
				t.is(type, ".js");
			}
		};
		const next = () => {
			t.fail("should not be called.");
			resolve();
		};
		middleware({
			method: "GET",
			url: "/resources/lib1/Control1.js",
			path: "/resources/lib1/Control1.js",
			query: {
				instrument: "true"
			}
		}, res, next);
	});
});
