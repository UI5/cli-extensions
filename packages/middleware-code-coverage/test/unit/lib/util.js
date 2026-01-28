import test from "ava";
import {
	createInstrumentationConfig,
	getLatestSourceMap,
	getLibraryCoverageExcludePatterns,
	readJsonFile,
	shouldInstrumentResource
} from "../../../lib/util.js";

// Node.js itself tries to parse sourceMappingURLs in all JavaScript files. This is unwanted and might even lead to
// obscure errors when dynamically generating Data-URI soruceMappingURL values.
// Therefore use this constant to never write the actual string.
const SOURCE_MAPPING_URL = "//" + "# sourceMappingURL";

function getMockedRequest(path="", query={}) {
	return {
		path,
		query
	};
}

test("createInstrumentationConfig: default config", async (t) => {
	const expectedConfig = {
		cwd: "./",
		instrument: {
			coverageGlobalScope: "window.top",
			coverageGlobalScopeFunc: false,
			produceSourceMap: true,
		},
		report: {
			"report-dir": "./tmp/coverage-reports",
			"reporter": [
				"html",
			],
			"watermarks": {
				branches: [
					50,
					80,
				],
				functions: [
					50,
					80,
				],
				lines: [
					50,
					80,
				],
				statements: [
					50,
					80,
				],
			},
		}
	};
	const config = await createInstrumentationConfig();
	t.deepEqual(config, expectedConfig);
});

test("createInstrumentationConfig: custom config", async (t) => {
	const expectedConfig = {
		cwd: "./myworkingdirectory",
		instrument: {
			coverageGlobalScope: "this",
			coverageGlobalScopeFunc: true,
			produceSourceMap: false,
		},
		report: {
			"report-dir": "./tmp/coverage-custom-reports",
			"reporter": [
				"json",
			],
			"watermarks": {
				branches: [
					60,
					90,
				],
				functions: [
					50,
					80,
				],
				lines: [
					50,
					80,
				],
				statements: [
					60,
					80,
				],
			},
		}
	};
	const config = await createInstrumentationConfig({
		cwd: "./myworkingdirectory",
		instrument: {
			coverageGlobalScope: "this",
			coverageGlobalScopeFunc: true,
			produceSourceMap: false,
		},
		report: {
			"report-dir": "./tmp/coverage-custom-reports",
			"reporter": [
				"json",
			],
			"watermarks": {
				branches: [
					60,
					90,
				],
				functions: [
					50,
					80,
				],
				lines: [
					50,
					80,
				],
				statements: [
					60,
					80,
				],
			},
		}
	});
	t.deepEqual(config, expectedConfig);
});

test("getLibraryCoverageExcludePatterns: .library excludes", async (t) => {
	const expectedPatterns = [
		/\/resources\/((([^/]+[/])*my-file))(-dbg)?.js$/,
		/\/resources\/((ui5\/customlib\/utils\/([^/]+[/])*[^/]*))(-dbg)?.js$/,
		/\/resources\/((ui5\/customlib\/Control1))(-dbg)?.js$/,
	];

	const sDotLibrary = `<?xml version="1.0" encoding="UTF-8" ?>
<library xmlns="http://www.sap.com/sap.ui.library.xsd" >
	<name>ui5.customlib</name>
	<appData>
		<jscoverage xmlns="http://www.sap.com/ui5/buildext/jscoverage" >
			<exclude name="/my-file" />
			<exclude name="ui5.customlib.utils." />
			<exclude name="ui5.customlib.Control1" />
			<exclude name="sap.m." external="true"/>
		</jscoverage>
	</appData>
</library>`;

	const reader = {
		byGlob() {
			return [{
				getString() {
					return sDotLibrary;
				}
			}];
		}
	};
	const patterns = await getLibraryCoverageExcludePatterns(reader);
	t.deepEqual(patterns, expectedPatterns);
});

test("getLibraryCoverageExcludePatterns: .library without jscoverage", async (t) => {
	const sDotLibrary = `<?xml version="1.0" encoding="UTF-8" ?>
<library xmlns="http://www.sap.com/sap.ui.library.xsd" >
	<name>ui5.customlib</name>
	<appData>
	</appData>
</library>`;

	const reader = {
		byGlob() {
			return [{
				getString() {
					return sDotLibrary;
				}
			}];
		}
	};
	const patterns = await getLibraryCoverageExcludePatterns(reader);
	t.deepEqual(patterns, []);
});

test("getLibraryCoverageExcludePatterns: .library without excludes", async (t) => {
	const sDotLibrary = `<?xml version="1.0" encoding="UTF-8" ?>
<library xmlns="http://www.sap.com/sap.ui.library.xsd" >
	<name>ui5.customlib</name>
	<appData>
		<jscoverage xmlns="http://www.sap.com/ui5/buildext/jscoverage" >
		</jscoverage>
	</appData>
</library>`;

	const reader = {
		byGlob() {
			return [{
				getString() {
					return sDotLibrary;
				}
			}];
		}
	};
	const patterns = await getLibraryCoverageExcludePatterns(reader);
	t.deepEqual(patterns, []);
});

test("getLibraryCoverageExcludePatterns: no .library files", async (t) => {
	const reader = {
		byGlob() {
			return [];
		}
	};
	const patterns = await getLibraryCoverageExcludePatterns(reader);
	t.deepEqual(patterns, []);
});

test("getLibraryCoverageExcludePatterns: multiple .library files", async (t) => {
	const sDotLibrary1 = `<?xml version="1.0" encoding="UTF-8" ?>
<library xmlns="http://www.sap.com/sap.ui.library.xsd" >
	<name>ui5.lib1</name>
	<appData>
		<jscoverage xmlns="http://www.sap.com/ui5/buildext/jscoverage" >
			<exclude name="ui5.lib1.Control1" />
		</jscoverage>
	</appData>
</library>`;

	const sDotLibrary2 = `<?xml version="1.0" encoding="UTF-8" ?>
<library xmlns="http://www.sap.com/sap.ui.library.xsd" >
	<name>ui5.lib2</name>
	<appData>
		<jscoverage xmlns="http://www.sap.com/ui5/buildext/jscoverage" >
			<exclude name="ui5.lib2.Control2" />
		</jscoverage>
	</appData>
</library>`;

	const reader = {
		byGlob() {
			return [
				{
					getString() {
						return sDotLibrary1;
					}
				},
				{
					getString() {
						return sDotLibrary2;
					}
				}
			];
		}
	};
	const patterns = await getLibraryCoverageExcludePatterns(reader);
	t.is(patterns.length, 2);
	t.true(patterns[0].test("/resources/ui5/lib1/Control1.js"));
	t.true(patterns[1].test("/resources/ui5/lib2/Control2.js"));
});

test("readJsonFile", async (t) => {
	const {name} = await readJsonFile("./package.json");
	t.is(name, "@ui5/middleware-code-coverage");
});

test("getLatestSourceMap", (t) => {
	const instrumenter = {
		lastSourceMap() {
			return `sap.ui.define(["library/d/some"],(n) => {o(n){var o=n;console.log(o)}o()});`;
		}
	};
	const sourcemap = getLatestSourceMap(instrumenter);

	t.is(sourcemap,
		// eslint-disable-next-line max-len
		`\r\n${SOURCE_MAPPING_URL}=data:application/json;charset=utf-8;base64,InNhcC51aS5kZWZpbmUoW1wibGlicmFyeS9kL3NvbWVcIl0sKG4pID0+IHtvKG4pe3ZhciBvPW47Y29uc29sZS5sb2cobyl9bygpfSk7Ig==`
	);
});

test("getLatestSourceMap: no source map", (t) => {
	const instrumenter = {
		lastSourceMap() {
			return null;
		}
	};
	const sourcemap = getLatestSourceMap(instrumenter);

	t.is(sourcemap, "", "If no source map can be determined an empty string is returned");
});

test("shouldInstrumentResource: No JS file", (t) => {
	const toBeInstrumented = shouldInstrumentResource(getMockedRequest("Test.html"));
	t.false(toBeInstrumented);
});

test("shouldInstrumentResource: Non flagged resources", (t) => {
	const toBeInstrumented = shouldInstrumentResource(getMockedRequest("Test.js"));
	t.false(toBeInstrumented);
});

test("shouldInstrumentResource: Flag resource as non instrumented", (t) => {
	t.false(shouldInstrumentResource(getMockedRequest("Test.js", {instrument: "false"})));
	t.false(shouldInstrumentResource(getMockedRequest("Test.js", {instrument: "0"})));
	t.false(shouldInstrumentResource(getMockedRequest("Test.js", {instrument: "undefined"})));
	t.false(shouldInstrumentResource(getMockedRequest("Test.js", {instrument: "null"})));

	t.false(shouldInstrumentResource(getMockedRequest("Test.js", {instrument: false})));
	t.false(shouldInstrumentResource(getMockedRequest("Test.js", {instrument: 0})));
	t.false(shouldInstrumentResource(getMockedRequest("Test.js", {instrument: undefined})));
	t.false(shouldInstrumentResource(getMockedRequest("Test.js", {instrument: null})));
});

test("shouldInstrumentResource: Resource flagged as instrumented, no excludes", (t) => {
	const toBeInstrumented = shouldInstrumentResource(getMockedRequest("Test.js", {instrument: "true"}), []);
	t.true(toBeInstrumented);
});

test("shouldInstrumentResource: Resource flagged as instrumented, but defined matching regex exclude", (t) => {
	const request = getMockedRequest("/resources/ui5/customlib/test/MyTest.js", {instrument: "true"});
	const excludePatterns = [
		/\/resources\/((ui5\/customlib\/test\/([^/]+[/])*[^/]*))(-dbg)?.js$/
	];
	const toBeInstrumented = shouldInstrumentResource(request, excludePatterns);
	t.false(toBeInstrumented);
});

test("shouldInstrumentResource: Resource flagged as instrumented, but defined matching pattern exclude", (t) => {
	const request = getMockedRequest("/resources/ui5/customlib/test/MyTest.js", {instrument: "true"});
	const excludePatterns = [
		new RegExp("/resources/ui5/customlib/test/MyTest\\.js")
	];
	const toBeInstrumented = shouldInstrumentResource(request, excludePatterns);
	t.false(toBeInstrumented);
});

test("shouldInstrumentResource: Resource flagged as instrumented, with no matching regex exclude", (t) => {
	const request = getMockedRequest("/resources/ui5/customlib/src/Control1.js", {instrument: "true"});
	const excludePatterns = [
		/\/resources\/((ui5\/customlib\/test\/([^/]+[/])*[^/]*))(-dbg)?.js$/
	];
	const toBeInstrumented = shouldInstrumentResource(request, excludePatterns);
	t.true(toBeInstrumented);
});

test("shouldInstrumentResource: Resource flagged as instrumented, with no matching pattern exclude", (t) => {
	const request = getMockedRequest("/resources/ui5/customlib/src/Control.js", {instrument: "true"});
	const excludePatterns = [
		new RegExp("/resources/ui5/customlib/test/MyTest\\.js")
	];
	const toBeInstrumented = shouldInstrumentResource(request, excludePatterns);
	t.true(toBeInstrumented);
});


