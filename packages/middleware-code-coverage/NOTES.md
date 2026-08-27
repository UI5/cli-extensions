# Follow-up Notes (bundle handling PoC)

Open items to address when turning the `bundleHandling` proof of concept
(`"instrument"` / `"unbundle"` modes) into a real solution:

- **iframe coverage reporting**: Check how coverage reporting within iframes has
  worked so far, and if it did, what is needed to keep it supported. The
  `Referer`-gate that engages `unbundle` mode is especially at risk here (an
  iframe's `Referer` may differ from the top-level coverage page, or be reduced
  by the referrer policy) and might require runtime adjustments.

- **Browser caching**: Make sure browser caching behaves as expected (e.g. use
  ETags like the `serveResources` middleware) so there is no stale `404` for
  bundles once a coverage run ends, and no other cache-related inconsistencies.

- **Resource tags for middlewares**: Middlewares should be able to read tags of
  built resources (e.g. `STANDARD_TAGS.IsBundle`) so the `//@ui5-bundle`
  first-line content-check workaround can be removed.

- **TypeScript**: Test the setup with TypeScript projects (using the
  `ui5-tooling-transpile` task).
