# Changelog

## [2.0.3](https://github.com/UI5/cli-extensions/compare/middleware-code-coverage-v2.0.2...middleware-code-coverage-v2.0.3) (2026-01-28)


### Bug Fixes

* **middleware-code-coverage:** Lazy evaluate exclude patterns ([#528](https://github.com/UI5/cli-extensions/issues/528)) ([262f7e7](https://github.com/UI5/cli-extensions/commit/262f7e71d0365e93be4f201a02ede10333f4575d))


### Dependencies

* Bump body-parser from 1.20.3 to 2.2.2 ([606e60e](https://github.com/UI5/cli-extensions/commit/606e60e4d48821b38ec83fcf4be66281a6861231))
* Bump serve-static from 2.2.0 to 2.2.1 ([3906abd](https://github.com/UI5/cli-extensions/commit/3906abd3da1bb34b3453894ab8a3bb713b145c6c))

## [2.0.2](https://github.com/UI5/cli-extensions/compare/middleware-code-coverage-v2.0.1...middleware-code-coverage-v2.0.2) (2025-10-20)


### Dependencies

* Bump istanbul-reports from 3.1.7 to 3.2.0 ([977244c](https://github.com/UI5/cli-extensions/commit/977244c55f1081667d4306f35feb623504ca53ce))
* Bump router from 2.0.0 to 2.1.0 ([0d12240](https://github.com/UI5/cli-extensions/commit/0d12240c003c9aa170ff728c77f130a4d6864792))
* Bump router from 2.1.0 to 2.2.0 ([c4878be](https://github.com/UI5/cli-extensions/commit/c4878bec44f96ae7834c6e788d282863e6caaa67))
* Bump serve-static from 1.16.2 to 2.2.0 ([fe86343](https://github.com/UI5/cli-extensions/commit/fe86343abc497ee68a7b2f73a98bfe5c7e38331e))

## [2.0.1](https://github.com/UI5/cli-extensions/compare/middleware-code-coverage-v2.0.0...middleware-code-coverage-v2.0.1) (2024-09-20)


### Dependencies

* Bump body-parser from 1.20.2 to 1.20.3 ([a244517](https://github.com/UI5/cli-extensions/commit/a244517c4736b9fa9ec80e813c1bf61ac22a2011))
* Bump serve-static from 1.15.0 to 1.16.0 ([c2bedbf](https://github.com/UI5/cli-extensions/commit/c2bedbffb5054cab75a9b0274385a0a42b3e177e))
* Bump sinon from 18.0.1 to 19.0.2 and router from 1.3.8 to 2.0.0 ([#303](https://github.com/UI5/cli-extensions/issues/303)) ([1516b38](https://github.com/UI5/cli-extensions/commit/1516b383c2bda0db3a78634f7181bcf0d56fcaf7))

## [2.0.0](https://github.com/UI5/cli-extensions/compare/middleware-code-coverage-v1.1.1...middleware-code-coverage-v2.0.0) (2024-07-25)


### ⚠ BREAKING CHANGES

* Support for older Node.js has been dropped. Only Node.js 20.11.x and >=22.0.0 as well as npm v8 or higher are supported.

### Features

* Drop support for node v16, v18, v21 ([#267](https://github.com/UI5/cli-extensions/issues/267)) ([40b607e](https://github.com/UI5/cli-extensions/commit/40b607e999a840b9135c2fcd1989d8505cf873f7))


### Dependencies

* bump istanbul-lib-instrument from 6.0.1 to 6.0.2 ([b7e0c58](https://github.com/UI5/cli-extensions/commit/b7e0c58f0774f8e33d8f55969b127b25d773f9e2))
* bump istanbul-reports from 3.1.6 to 3.1.7 ([db471fd](https://github.com/UI5/cli-extensions/commit/db471fd60c7d8d39baec3e50a68be6b191ba2c0b))

## [1.1.1](https://github.com/UI5/cli-extensions/compare/middleware-code-coverage-v1.1.0...middleware-code-coverage-v1.1.1) (2023-11-24)


### Bug Fixes

* **middleware-code-coverage:** fix incomplete string escaping or encoding ([#194](https://github.com/UI5/cli-extensions/issues/194)) ([87cabdb](https://github.com/UI5/cli-extensions/commit/87cabdb6c6839e19c088e675b97b3f1e0beb9f81))


### Dependencies

* bump istanbul-lib-coverage from 3.2.0 to 3.2.2 ([a60139b](https://github.com/UI5/cli-extensions/commit/a60139b21428b95832a1ed8525ddb573d16c0ec5))
* bump istanbul-lib-instrument from 6.0.0 to 6.0.1 ([0057e96](https://github.com/UI5/cli-extensions/commit/0057e96105faabec6a391c02f90b271f70128382))

## [1.1.0](https://github.com/UI5/cli-extensions/compare/middleware-code-coverage-v1.0.3...middleware-code-coverage-v1.1.0) (2023-09-19)


### Features

* **middleware-code-coverage:** allow coverage watermarks configuration via frontend ([#145](https://github.com/UI5/cli-extensions/issues/145)) ([ece9fa6](https://github.com/UI5/cli-extensions/commit/ece9fa64e04a93d69d910a41016ad197fa0beae9))


### Dependencies

* bump istanbul-lib-instrument from 5.2.1 to 6.0.0 ([fbf8b29](https://github.com/UI5/cli-extensions/commit/fbf8b29664fb6a9f953ea88dd22b14911be0dffe))
* bump istanbul-lib-report from 3.0.0 to 3.0.1 ([9bc4b39](https://github.com/UI5/cli-extensions/commit/9bc4b39ba91aebcd34e3b1d91cdd0cf545cc7f46))
* bump istanbul-reports from 3.1.5 to 3.1.6 ([bd5a78a](https://github.com/UI5/cli-extensions/commit/bd5a78abaf0cf8a1218db9b2e076442398e4c184))
* bump xml2js from 0.6.0 to 0.6.2 ([18904fe](https://github.com/UI5/cli-extensions/commit/18904fee24f2a06ace088d2eb639154acb1375a6))

## [1.0.3](https://github.com/UI5/cli-extensions/compare/middleware-code-coverage-v1.0.2...middleware-code-coverage-v1.0.3) (2023-04-18)


### Bug Fixes

* **middleware-code-coverage:** ignore excludes marked as 'external' ([#82](https://github.com/UI5/cli-extensions/issues/82)) ([7daeaea](https://github.com/UI5/cli-extensions/commit/7daeaea7634013148b8784e94357b60968b718d7))

## [1.0.2](https://github.com/UI5/cli-extensions/compare/middleware-code-coverage-v1.0.1...middleware-code-coverage-v1.0.2) (2023-04-14)


### Bug Fixes

* **deps:** bump xml2js from 0.4.23 to 0.5.0 ([#77](https://github.com/UI5/cli-extensions/issues/77)) ([300d62e](https://github.com/UI5/cli-extensions/commit/300d62ebc44e404e0fcea07168bff72b46455628))

## [1.0.1](https://github.com/UI5/cli-extensions/compare/middleware-code-coverage-v1.0.0...middleware-code-coverage-v1.0.1) (2023-03-28)


### Bug Fixes

* **middleware-code-coverage:** fix ping endpoint middleware version ([e59e921](https://github.com/UI5/cli-extensions/commit/e59e921780ace11cdf2bc1ff98e2af241580f118))

## 1.0.0 (2023-03-22)


### Features

* **middleware-code-coverage:** add middleware ([e122b92](https://github.com/UI5/cli-extensions/commit/e122b92db5e2cbc3a419be0c8b9ff4e849659a1c))
