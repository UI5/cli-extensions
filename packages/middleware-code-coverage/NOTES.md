# Follow-up Notes (coverage via client-side un-bundling)

Open items for the coverage approach (the client un-bundles covered modules via `sap-ui-debug`,
the middleware instruments the requested `-dbg` sources and reports them under the runtime path).
See `docs/bundle-handling-options.md` for the full options analysis.

- **OpenUI5 ergonomics**: today the coverage test page must be loaded with
  `sap-ui-debug="<cover globs>"` by hand. The UI5 test starter (`_setupAndStart.js`, istanbul
  branch) could auto-derive this from the QUnit `cover-only` / `cover-never` config via
  `sap.ui.loader.config({ ignoreBundledResources: <filter>, debugSources: true })`, honoring
  `cover-never` exactly (which the positive-only `sap-ui-debug` glob string cannot express).

- **iframe coverage reporting**: coverage still requires `?coverage` to reach each test-page
  iframe (to activate the coverage client and the `?instrument` hooks). `TestRunner.js` sets the
  execution iframe `src` without propagating `?coverage`; this is a small, deterministic fix needed
  independently of the middleware. The un-bundling signal itself (`sap-ui-debug`) is read per-frame
  (e.g. from `localStorage`), so it is not affected by `Referer` / `Referrer-Policy`.

- **Sanctioned middleware tag API**: bundles are skipped using the `ui5:IsBundle` resource tag, but
  `MiddlewareUtil` exposes no tag access, so the middleware currently reads it off the built
  resource's own project (`Resource#getProject().getResourceTagCollection(...)`), reaching past the
  Specification Version interface. UI5 CLI should expose a sanctioned middleware tag API —
  `getTag` + `STANDARD_TAGS` on `MiddlewareUtil`, symmetric with `TaskUtil` on the build side
  (routing to the correct tag collection; the no-arg `Resource#getTags()` only reads the project
  collection and misses `IsBundle`). Likely a follow-up CLI BLI, sibling to the `builtResources`
  work (CPOUI5FOUNDATION-1306).

- **TypeScript**: test the setup with TypeScript projects (using the `ui5-tooling-transpile` task;
  mind the double source map).

- **`sap.ui.core` caveat**: `sap-ui-core.js` is the bootstrap script and predefines its modules
  before any config runs, so core itself cannot be un-bundled this way. Affects covering core, not
  application/library code.
