# DOMQL

A small language for querying the DOM. A query names what its caller wants to know about a document and its elements, and evaluating it gives one answer shaped the way it asked; the same query is read once, watched for changes, or evaluated at each occurrence of something that happened in the document.

```
@panel {
    size,
    hasFocus: matches(":focus-within"),
    items: all("[data-key]") { key: attribute-of "id", height: rect.height }
}
```

The language knows how to name values and shape answers; what can be asked about comes from a vocabulary beside it, which extensions grow without changing the grammar.

- The [DOMQL specification](docs/domql-specification.md) defines the language: its syntax, what each request means, the contracts of its vocabulary and the definition every request has.
- The [DOMQL design](docs/domql-design.md) sets out how requests are built, prepared and carried out.

## Layout

```text
src/            # the language: domql.js and the modules it imports
tests/          # its tests, under Vitest and happy-dom
scripts/        # bundle.mjs, which makes the single file the package ships
nuget/          # the package project, which serves the bundle as wwwroot/domql.js
docs/           # the specification and the design
```

DOMQL is a JavaScript library. It is published as the NuGet package `formaui-net.DOMQL`, which carries one minified file, `domql.js`, bundled from `src/` and served from `_content/domql/`.

## Building

`./build.ps1` is the gate: it runs the tests, bundles `src/` into `nuget/wwwroot/domql.js`, builds the package project and checks its formatting. `./publish.ps1` runs the gate and packs the package into `artifacts/`. The tests also run on their own with `npm test` from `tests/`.
