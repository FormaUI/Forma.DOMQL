# DOMQL

A small language for querying the DOM. A query names what its caller wants to know about a document and its elements, and evaluating it gives one answer shaped the way it asked; the same query is read once, watched for changes, or evaluated at each occurrence of something that happened in the document.

```
@panel {
    size,
    hasFocus: matches(":focus-within"),
    items: all("[data-key]") { key: attribute "id", height: rect.height }
}
```

The language knows how to name values and shape answers; what can be asked about comes from a vocabulary beside it, which extensions grow without changing the grammar.

- The [DOMQL specification](docs/domql-specification.md) defines the language: its syntax, what each request means, the contracts of its vocabulary and the definition every request has.
- The [DOMQL design](docs/domql-design.md) sets out how requests are built, prepared and carried out.

## Layout

```text
Forma.DOMQL.slnx
├── src/Forma.DOMQL                     # the language: its scripts under wwwroot/scripts/, served as _content/Forma.DOMQL
└── tests/Forma.DOMQL.Tests.Scripts     # the scripts' tests, under Vitest and happy-dom
```

The project ships as the package `formaui-net.DOMQL`. Forma, its first consumer, references it from a checkout beside its own.

## Building

`./build.ps1` is the gate: it builds the solution, runs the script tests and checks the formatting. The script tests also run on their own with `npm test` from their folder.
