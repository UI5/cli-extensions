# UI5 Extension Name

Describe the basic benefit of this extension.

## Requirements

This middleware requires UI5 CLI Version 3 and above.

## Install

```sh
npm install ui5-extension-xx --save-dev
```

## Usage

1. Define the dependency in `$yourapp/package.json`:

```json
"devDependencies": {
    // ...
    "ui5-extension-xx": "*"
    // ...
}
```

2. Configure it in `$yourapp/ui5.yaml`:

The configuration for the extension:

```yaml
server:
  customMiddleware:
  - name: ui5-extension-xx
    afterMiddleware: compression
    configuration:
      property1: Value1
```

3. Explain further steps

### Configuration

`parameter1` [Type]: Descritpion

## How it works

Describe in more details what the extensions does.

## Code of Conduct

Please check our [Code of Conduct](https://github.com/UI5/cli-extensions/blob/main/CODE_OF_CONDUCT.md).

## Contributing

Please check our [Contribution Guidelines](https://github.com/UI5/cli-extensions/blob/main/CONTRIBUTING.md).

## Support

Please follow our [Contribution Guidelines](https://github.com/UI5/cli-extensions/blob/main/CONTRIBUTING.md#report-an-issue) on how to report an issue. Or chat with us in the [`#tooling`](https://openui5.slack.com/archives/C0A7QFN6B) channel of the [OpenUI5 Community Slack](https://join.slack.com/t/openui5/shared_invite/zt-1q128gn3p-JeZTi9XCpPxW8kBohSgqnw). For public Q&A, use the [`ui5-cli` tag on Stack Overflow](https://stackoverflow.com/questions/tagged/ui5-cli).

## Licensing

Copyright 2026 SAP SE or an SAP affiliate company and UI5 CLI Extensions contributors. Please see our [LICENSE.txt](../../LICENSE.txt) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available via the [REUSE tool](https://api.reuse.software/info/github.com/UI5/cli-extensions).
