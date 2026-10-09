# DOMQL

> **Preview, not yet published to NuGet.** The package `formaui-net.DOMQL` is not on NuGet yet. Build it from this repository to try it; see [Development](#development).

DOMQL is an extensible query language for reading DOM state as plain data. Describe the values you need—across one element, a collection or several targets—and receive an answer with the same shape.

```text
@panel {
    count: children.count,
    selected: first("[aria-selected=true]").attribute-of "data-key"
}
```

```json
{ "count": 3, "selected": "a2" }
```

DOMQL brings member lookup, argument validation, null handling and result shaping into one reusable model. Its vocabulary is extensible: modules add concepts without changing the grammar. It is designed for use by libraries and applications and is not tied to a particular UI component framework.

DOMQL is a JavaScript library. It is packaged as the NuGet package `formaui-net.DOMQL`, which is not yet published and which carries one minified file, `domql.js`, bundled from `src/` and served from `_content/domql/`. To use it, start with the [package README](nuget/README.md): how to load it, the language by example, the API and how to extend the vocabulary.

## Current scope

The current implementation supports **one-shot reads through the JavaScript API**. The broader design includes watching state, projecting events, actions and behaviors; those capabilities are not yet executable.

| Available | Planned |
| --- | --- |
| Parse text or create a query from a JSON definition | Watch queries and deliver state changes |
| Validate definitions, bindings and vocabulary usage | Listen to occurrence sources such as `events-of` |
| Resolve names and types without reading the DOM | Execute actions and establish behaviors |
| Read synchronous DOM members and return immutable data | Read maintained observations such as `intersects` |
| Extend the vocabulary through modules | Observation lifetimes and occurrence delivery |

A declaration can describe a capability before its runtime support exists. Successful resolution does not by itself mean a request can execute in the current release or host.

## Documents

- The [package README](nuget/README.md) teaches the library: loading it, reading queries, the language by example, the API, errors and extending the vocabulary.
- The [specification](docs/domql-specification.md) defines the language: syntax, types, null behavior, vocabulary contracts and the JSON definition.
- The [design](docs/domql-design.md) sets out how it runs: construction, resolution, execution, caching, modules and the planned observation lifetimes.

The specification and design describe the complete intended system; use the status table above to tell those contracts from the runtime features available today.

## Development

### Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | JavaScript source, including the `domql.js` entry point |
| `tests/` | Vitest tests and happy-dom test environment |
| `scripts/` | Bundling scripts |
| `nuget/` | Package project, the package README and the generated `wwwroot/domql.js` bundle |
| `docs/` | Language specification and runtime design |

### Build and test

Use Node.js/npm, the .NET SDK and PowerShell versions required by the repository's package and SDK configuration. Install the test dependencies before the first run:

```sh
cd tests
npm install
npm test
```

From the repository root:

```powershell
./build.ps1
```

The build gate runs tests, bundles the source into `nuget/wwwroot/domql.js`, builds the package project and checks formatting. To run the gate and create the NuGet package in `artifacts/`, which is how to get the package until it is published:

```powershell
./publish.ps1
```

The documented role of `publish.ps1` is local package creation. Uploading a package to a feed is a separate release step. To try the package locally, add `artifacts/` as a NuGet source.

### Where to work

The main flow is text or JSON definition → validation and resolution → evaluation → immutable answer.

| Component | Responsibility |
| --- | --- |
| `Vocabulary` | Built-in type and member declarations |
| `DomqlModule` | A module's declarations and functions |
| `ModuleRegistry` | Registered modules and declaration lookup |
| `ParameterBindings` | Named values and their inferred or declared types |
| `LanguageResolver` | Resolve a definition and validate its vocabulary usage |
| `ResolvedDefinition` | The definition, resulting type and recorded resolutions |
| `QueryEvaluator` | Evaluate a resolved query and produce data |
| `DomqlError` | Structured failures and locations |

Change the source files, then regenerate the bundle through the build. The repository's [working rules](CLAUDE.md) set out how a change is made and checked.
