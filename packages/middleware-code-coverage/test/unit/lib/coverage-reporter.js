import test from "ava";
import esmock from "esmock";
import sinonGlobal from "sinon";
import {createInstrumentationConfig} from "../../../lib/util.js";

const coverageData = {
	coverage: {
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
	}
};

const mockedResource = {
	all: {
		byPath() {
			return {
				getString() {
					return `sap.ui.define([
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
				}
			};
		}
	}
};

test.beforeEach(async (t) => {
	t.context.sinon = sinonGlobal.createSandbox();
	t.context.coverageReporter = await esmock("../../../lib/coverage-reporter.js");
});

test.afterEach.always((t) => {
	t.context.sinon.restore();
});

test("Report Coverage", async (t) => {
	const {coverageReporter} = t.context;
	const expectedConfig = {
		availableReports: [{
			destination: "html/",
			report: "html"
		}],
		coverageMap: [
			"/resources/Control1.js"
		],
	};

	const config = await createInstrumentationConfig();
	const report = await coverageReporter(coverageData, config, mockedResource);
	t.deepEqual(report, expectedConfig);
});

test("Report Coverage (old structure)", async (t) => {
	const {coverageReporter} = t.context;
	const expectedConfig = {
		availableReports: [{
			destination: "html/",
			report: "html"
		}],
		coverageMap: [
			"/resources/Control1.js"
		],
	};

	const config = await createInstrumentationConfig();
	const report = await coverageReporter(coverageData.coverage, config, mockedResource);
	t.deepEqual(report, expectedConfig);
});

test("Report Coverage: lcov reporter", async (t) => {
	const {coverageReporter} = t.context;
	const expectedConfig = {
		availableReports: [{
			destination: "lcov/lcov.info",
			report: "lcov"
		}, {
			destination: "lcov/lcov-report",
			report: "html"
		}],
		coverageMap: [
			"/resources/Control1.js"
		],
	};

	const config = await createInstrumentationConfig({
		report: {
			"reporter": ["lcov"]
		}
	});
	const report = await coverageReporter(coverageData, config, mockedResource);
	t.deepEqual(report, expectedConfig);
});


test("Report Coverage: Log warning if resource can not be found", async (t) => {
	const {sinon, coverageReporter} = t.context;
	const expectedConfig = {
		availableReports: [{
			destination: "html/",
			report: "html"
		}],
		coverageMap: [
			"/resources/Control1.js"
		],
	};

	const mockedResource = {
		all: {
			byPath() {
				return undefined;
			}
		}
	};
	const warnLogStub = sinon.stub();
	const log = {
		warn: warnLogStub
	};
	const config = await createInstrumentationConfig();
	const report = await coverageReporter(coverageData, config, mockedResource, log);

	t.is(warnLogStub.callCount, 1);
	t.is(warnLogStub.getCall(0).args[0],
		"/resources/Control1.js not found! Detailed report can't be generated for that resource!");
	t.deepEqual(report, expectedConfig);
});

// ESM import + sinon.spy on "istanbul-lib-report" causes an already wrapped exception on windows + nodejs 20.6.1
// Running tests that spy on "istanbul-lib-report" serially solves this issue as after every test
// the mocking is cleared (esmock.purge)
test.serial("Report Coverage: Fronted config for watermarks", async (t) => {
	const {sinon} = t.context;
	const libReport = await esmock.p("istanbul-lib-report");
	const coverageReporter = await esmock.p("../../../lib/coverage-reporter.js", {
		"istanbul-lib-report": libReport
	});
	const reportSpy = sinon.spy(libReport, "createContext");

	const modifiedWatermarks = {
		statements: [5, 10],
		functions: [15, 20],
		branches: [25, 30],
		lines: [35, 40],
	};

	const config = await createInstrumentationConfig();
	const {watermarks: defaultWatermarks} = config.report;

	await coverageReporter({...coverageData, watermarks: modifiedWatermarks},
		config,
		mockedResource
	);

	let reportedWatermarks = reportSpy.lastCall.args[0].watermarks;
	t.deepEqual(reportedWatermarks, modifiedWatermarks, "Watermarks got updated");

	await coverageReporter(coverageData, config, mockedResource);

	reportedWatermarks = reportSpy.lastCall.args[0].watermarks;
	t.notDeepEqual(reportedWatermarks, modifiedWatermarks, "Watermarks state is not persisted");
	t.deepEqual(reportedWatermarks, defaultWatermarks, "Default watermarks got used");

	esmock.purge(libReport);
	esmock.purge(coverageReporter);
});

// ESM import + sinon.spy on "istanbul-lib-report" causes an already wrapped exception on windows + nodejs 20.6.1
// Running tests that spy on "istanbul-lib-report" serially solves this issue as after every test
// the mocking is cleared (esmock.purge)
test.serial("Report Coverage: Fronted config for watermarks- overwrite just some properties", async (t) => {
	const {sinon} = t.context;
	const libReport = await esmock.p("istanbul-lib-report");
	const coverageReporter = await esmock.p("../../../lib/coverage-reporter.js", {
		"istanbul-lib-report": libReport
	});
	const reportSpy = sinon.spy(libReport, "createContext");

	const config = await createInstrumentationConfig();
	const {watermarks: defaultWatermarks} = config.report;

	await coverageReporter(
		{...coverageData, watermarks: {statements: [5, 10]}},
		config,
		mockedResource
	);

	const reportedWatermarks = reportSpy.lastCall.args[0].watermarks;
	t.deepEqual(reportedWatermarks, {...defaultWatermarks, ...{statements: [5, 10]}},
		"Only 'statements' got updated. The rest is with default values."
	);

	esmock.purge(libReport);
	esmock.purge(coverageReporter);
});

test("Report Coverage: remaps through an embedded input source map to the original source", async (t) => {
	const {coverageReporter} = t.context;

	// A file instrumented from a TypeScript project's transpiled -dbg source carries an input source
	// map back to the original .ts in its coverage data. The reporter must remap coverage onto that
	// .ts and render it from the map's embedded sourcesContent (not the build output).
	const tsCoverage = {
		coverage: {
			"/resources/covered/lib/Thing.js": {
				path: "/resources/covered/lib/Thing.js",
				statementMap: {"0": {start: {line: 1, column: 0}, end: {line: 1, column: 20}}},
				fnMap: {},
				branchMap: {},
				s: {"0": 1},
				f: {},
				b: {},
				inputSourceMap: {
					version: 3,
					file: "Thing.js",
					sources: ["Thing.ts"],
					sourcesContent: ["export const greet = 1;\n"],
					names: [],
					mappings: "AAAA" // generated (1,0) -> Thing.ts (1,0)
				}
			}
		}
	};

	// builtResources must NOT be consulted for the remapped .ts (its source comes from the map).
	const builtResources = {
		all: {
			byPath() {
				throw new Error("builtResources should not be read for a source-map-backed .ts");
			}
		}
	};

	const config = await createInstrumentationConfig();
	const report = await coverageReporter(tsCoverage, config, builtResources);

	t.deepEqual(report.coverageMap, ["/resources/covered/lib/Thing.ts"],
		"coverage is remapped from the runtime .js path to the original .ts source");
});
