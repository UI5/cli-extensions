# Coverage bundle handling & TypeScript support — evaluation and follow-ups (CPOUI5FOUNDATION-1342)

Single reference for how `@ui5/middleware-code-coverage` produces faithful per-file coverage under
UI5 CLI **v5**, where the client loads code as **bundles**: the candidate approaches and their
trade-offs, the TypeScript solution, and open follow-ups.


## Status at a glance

Approaches **A** (`instrument`) and **B** (`unbundle`) were prototyped behind a `bundleHandling`
config option and validated on v5; that code now lives in the branch history. Approach **C**
(runtime-driven un-bundling) is the approach currently implemented. The
**pre-build task** was discussed but not prototyped. The sections below evaluate all four on equal
terms.

## Problem

Code coverage requires every executed JS file to be **instrumented** (rewritten with counters). The
middleware does this per file, on request (`?instrument`). But UI5 serves **bundles** —
`library-preload.js`, `sap-ui-core.js`: many modules concatenated and **minified**. Bundled code
reaches the browser without passing through per-file instrumentation, so it yields **no coverage**.

Two things set the stage:

- **CLI v5 reader split (CPOUI5FOUNDATION-1306).** Custom middleware (Specification Version 5.0+)
  now receive two readers: `resources` (unbuilt sources) and **`builtResources`** (the build output
  the client actually loads, incl. bundles **and** `-dbg` files). The whole topic is v5-only; v4
  rejects `specVersion: '5.0'`.
- **Minification.** Bundles ship minified; the unminified source lives in the `-dbg` variant
  (e.g. `Button-dbg.js`) and in the bundle's indexed source map.

## Approaches

### A. `instrument` — instrument the bundle in place 🔬
*(ticket Option A)*

Serve the bundle, but instrument it, attributing coverage to the individual original files via the
bundle's **indexed source map** (each section sliced out, re-mapped, handed to istanbul with the
`-dbg` content embedded). All JS is instrumented regardless of `?instrument`; the client must trim
`window.__coverage__` before reporting.

- **Pro:** no change to how the client loads; works wherever an indexed map exists.
- **Con:** the slices are **minified**, so coverage is **coarse** (per-statement granularity
  collapses). Faithful per-line coverage would require un-minified bundles.
- **Validated (2026-10-01):** bundle served instrumented, runnable, coverage attributed to the
  individual sources — but minified (`multiply:function(n,t)`), confirming the coarseness.

### B. `unbundle` — 404 the bundle, serve instrumented `-dbg` modules 🔬
*(ticket Option B)*

During a coverage run, respond to a bundle request with **404** so the runtime falls back to loading
individual modules; serve each from its unminified `-dbg` source, instrumented, keyed to the runtime
path. Engagement is gated on a **coverage `Referer`** (the test page URL carries `?coverage`).

- **Pro:** real **per-line** coverage from unminified sources.
- **Con:** the **`Referer` gate is fragile** — in iframes the referrer may be the iframe's own URL
  or be reduced by `Referrer-Policy` (dropping `?coverage`), silently disabling the mode. The
  per-bundle 404 is **all-or-nothing**: un-covering one module forces the whole bundle individual.
- **Validated (2026-10-01):** inert without a coverage Referer; 404 with one; module served
  instrumented from the `-dbg` source; report renders the unminified source.

### C. runtime-driven un-bundling — middleware instruments the `-dbg` sources

Move the un-bundling decision to the **runtime**: it derives which modules to load un-bundled from the
coverage configuration (the cover-only/cover-never filter) and sets `ignoreBundledResources`
accordingly — no manually-set flag on the coverage page. UI5's loader then (for matching modules only)
ignores the bundled definition and fetches the individual **`-dbg`** module, which the existing
coverage hook rewrites to `?instrument=true`. The middleware has **no 404 and no `Referer` gate** — it
instruments the requested `-dbg` resource and reports it under the runtime path (`fromDebugPath`).
Bundles are never instrumented: a bundle requested with `?instrument` is detected via its
`ui5:IsBundle` resource tag — or, when that tag is absent (the `minify` task skipped), a leading
`//@ui5-bundle` content marker — and served verbatim (instrumenting the minified, concatenated bundle
would corrupt coverage).

Mechanism (verified in the OpenUI5 loader):
- `sap-ui-debug` **glob (string) form** sets a filtered `ignoreBundledResources` + `debugSources`
  **without a page reboot** (`ui5loader-autoconfig.js:922-993`); only `sap-ui-debug=true` reboots.
- `ignoreBundledResources` works **per-module even within a downloaded bundle** (`ui5loader.js:990`):
  matched modules stay `INITIAL` and are re-fetched individually; the rest keep being served from the
  bundle.
- The async `<script>` load tags the request `data-sap-ui-module="<clean name>"` while `src` is the
  `-dbg` URL (`ui5loader.js:1465`), so `shouldBeInstrumented` matches and `?instrument` is appended.

- **Pro:** no fragile `Referer` gate; **no 404s**; **finer-grained** than `unbundle` (only covered
  modules go individual, the bundle still serves the rest); reuses a public, established UI5 mechanism.
- **Con:** to be seamless it needs a UI5 **runtime change** — the test starter auto-deriving
  `ignoreBundledResources` from the cover config (see follow-ups); without it the coverage page must
  set the un-bundle config by hand. The bundle is still downloaded (200) even though covered modules
  are also fetched individually — negligible for a few covered files.

**Iframe robustness:** the un-bundle signal is **client-side config read per-frame**, deliverable via
`window.localStorage` (shared per origin → inherited by every same-origin iframe,
`ui5loader-autoconfig.js:894`) or the `data-sap-ui-debug` attribute — not an HTTP header, so
`Referrer-Policy` is irrelevant. The separate need for `?coverage` to reach the iframe (to activate
the coverage client/hooks) is a pre-existing gap shared by all approaches — `TestRunner.js` sets the
execution iframe `src` without propagating `?coverage` — and is a small deterministic fix.

### D. Pre-build instrumentation task 💡
*(ticket Option C)*

A new build task that instruments all sources **before** bundling; the middleware only produces the
final reports.

- **Pro:** coverage is baked into the build output; the middleware stays simple.
- **Con:** needs alignment with TS transpiling (double source map); requires a **full rebuild** when
  enabling coverage; requires a global switch between instrumented and original files. Not prototyped.

### Rejected variant
- **`sap-ui-debug=true` / global un-bundle (+ instrument-all):** reboots the page and un-bundles the
  *entire* framework for no added coverage; instrumentation is gated separately
  (`shouldBeInstrumented`), so disabling bundles doesn't instrument more by itself; instrumenting
  everything bloats `window.__coverage__` and is far slower. Targeting is both correct and cheap.

## Comparison

| | A `instrument` | B `unbundle` | C runtime un-bundle | D pre-build task |
|---|---|---|---|---|
| Coverage fidelity | coarse (minified) | per-line | per-line | per-line |
| Un-bundle driver | n/a (bundle instrumented) | server 404 | client (`ignoreBundledResources`) | n/a (pre-build) |
| 404s | no | yes | no | no |
| Referer gate | no | yes (fragile) | no | no |
| Iframe-robust | n/a | ✗ | ✅ (client config) | ✅ |
| Granularity | whole bundle | whole bundle | per module | n/a |
| Needs runtime change | no | no | auto-derive (opt. OpenUI5 ergonomics) | build task |
| Rebuild to enable | no | no | no | yes |
| Status | 🔬 prototyped | 🔬 prototyped | ✅ implemented | 💡 discussed |

## TypeScript support

TypeScript projects transpile `.ts` → JS (via the `ui5-tooling-transpile` task); without extra
handling, coverage lands on the generated JS, not the `.ts` the developer wrote. The solution layers
on top of approach C and attributes coverage to the original `.ts`:

1. **Attach the input source map (middleware).** When instrumenting the `-dbg` source, the middleware
   reads the source's `sourceMappingURL` via `loadInputSourceMap` — handling an **inline data-URI**
   map or an **external** map resolved relative to the source and read from `builtResources` — and
   passes it to istanbul as a plain object. istanbul embeds it in the coverage data, so it travels in
   `window.__coverage__`. A missing/unparseable map is ignored (instrumented without one).
2. **Remap at report time (reporter).** The reporter runs the posted coverage through
   `istanbul-lib-source-maps` `transformCoverage()`, which uses those embedded maps to re-key and
   re-locate coverage onto the original `.ts`. A **no-op for plain JS** (no embedded map → stays
   keyed to the runtime path).
3. **Render the original source safely.** The `.ts` text for the report is read from the sandboxed
   `builtResources` reader (the transpile copies `.ts` into the build output) — **never the raw
   filesystem**, because coverage keys and their maps come from client-posted data (an fs read there
   would be an arbitrary-file-read).

Probe-verified facts (ui5-tooling-transpile + minify, v5): the `-dbg` carries a **flat** (non-indexed)
sibling map `Thing-dbg.js.map` with `sources: ["Thing.ts"]` and `sourcesContent`; because the map is
flat, a plain source-map object suffices (no `@jridgewell/trace-mapping`/`AnyMap`); plain-JS modules
have **no** `-dbg` map, so the remap is correctly a no-op for them.


## Follow-ups / open items

- **Caching (specific to B).** Only relevant to the prototyped `unbundle` approach, not the
  implemented approach C (which issues no 404s): use ETags (like `serveResources`) so there's no stale
  `404` for bundles after a run.
- **Sanctioned middleware tag API.** Expose `getTag` + `STANDARD_TAGS` on `MiddlewareUtil` (symmetric
  with `TaskUtil`, routing to the correct tag collection — the no-arg `Resource#getTags()` only reads
  the project collection and misses `IsBundle`) to replace the interim project-reach-through. The
  `//@ui5-bundle` content-marker fallback already de-risks a missing tag (it is absent when `minify` is
  skipped), so this is an ergonomics/correctness improvement rather than a blocker. Likely a follow-up
  CLI BLI, sibling to CPOUI5FOUNDATION-1306.

### openui5 runtime

Runtime-side (OpenUI5) work that completes approach **C** (runtime-driven un-bundling) — the
middleware already covers the server side. The `ignoreBundledResources` auto-derive makes C seamless
(no manually-set flag); the `?coverage` propagation is a shared prerequisite that also benefits the
other approaches.

- **auto-derive the un-bundle config.** So the coverage page need not carry it by
  hand, auto-derive in `_setupAndStart.js` (istanbul branch, before `bootCore`) from the QUnit
  `cover-only`/`cover-never` config: `sap.ui.loader.config({ ignoreBundledResources: <filter>,
  debugSources: true })`, honoring `cover-never` exactly (a positive-only `sap-ui-debug` glob string
  cannot express an exclusion). Clone-only OpenUI5 repo (`_setupAndStart.js`, before `bootCore`).
- **iframe `?coverage` propagation.** `TestRunner.js` should propagate `?coverage` onto the execution
  iframe `src` (like `hidepassed`) so the covered run activates per frame. Needed by all approaches.
