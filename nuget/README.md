# DOMQL

> **Preview, not yet published to NuGet.** The package `formaui-net.DOMQL` is not on NuGet yet. Build it from the [repository](https://github.com/FormaUI/Forma.DOMQL#development) to try it, as [Install and load](#install-and-load) shows.

DOMQL is an extensible query language for reading DOM state as plain data. Select the properties you need, project collections into objects, and reuse the same query against changing document state or different targets.

The `formaui-net.DOMQL` NuGet package supplies the JavaScript library as a single minified ES module at `_content/domql/domql.js`. It can be used by applications and libraries. The API documented here runs in JavaScript.

## Current capabilities

Available now:

- Parse query text or create queries from JSON definitions.
- Validate structure, bindings, vocabulary names and types.
- Resolve queries without reading the DOM.
- Perform synchronous one-shot reads and receive immutable data snapshots.
- Extend the vocabulary through modules.

Watching changes, listening to occurrences, actions, behaviors and maintained observations such as `intersects` are planned. A vocabulary declaration alone does not make those runtime capabilities available.

## Install and load

The package is not published to NuGet yet. Build it from the repository with `./publish.ps1`, which writes it to `artifacts/`, and add it from there:

```sh
dotnet add package formaui-net.DOMQL --prerelease --source ./artifacts
```

Once it is published, `dotnet add package formaui-net.DOMQL --prerelease` adds it from NuGet.

In a .NET web application hosted at the site root, import the static web asset from a JavaScript module:

```js
import { Domql } from '/_content/domql/domql.js';
```

If the application is hosted under a subpath, include that base path in the URL. The bundle can also be served directly in a non-.NET application. For building a local package, see the [repository README](https://github.com/FormaUI/Forma.DOMQL#development).

## TypeScript

The package serves `domql.d.ts` beside `domql.js`, so a TypeScript project that imports the bundle by its path has the types of the whole API: `Domql`, the queries it makes, the resolved definition, `DomqlError` and the module declarations.

```ts
import { Domql } from '/_content/domql/domql.js';

const count = Domql.read<number>(Domql.parse('@panel.children.count', { panel }));
```

## Read a query

Given this markup, which the examples below use throughout:

```html
<div id="panel">
    <div data-key="a1" style="height: 48px"></div>
    <div data-key="a2" style="height: 64px" aria-selected="true"></div>
    <div data-key="a3" style="height: 48px"></div>
</div>
```

Run this after the elements exist:

```js
const panel = document.getElementById('panel');

const query = Domql.parse(`
    @panel {
        count: children.count,
        items: all("[data-key]") {
            key: attribute-of "data-key",
            selected: matches "[aria-selected=true]"
        }
    }
`, { panel });

const snapshot = Domql.read(query);
// {
//   count: 3,
//   items: [
//     { key: 'a1', selected: false },
//     { key: 'a2', selected: true },
//     { key: 'a3', selected: false }
//   ]
// }
```

`@panel` refers to the supplied binding; it is not an ID lookup. `parse` constructs the query without reading the DOM. `read` resolves it as needed and returns the current answer synchronously. The snapshot is immutable and contains no live element references.

## Read again or bind another target

Reuse a query for repeated reads. Resolution is cached when compatible; DOM values are read again, and earlier snapshots remain unchanged.

```js
const countQuery = Domql.parse('@panel.children.count', { panel });

Domql.read(countQuery);
// 3

const emptyPanel = document.createElement('div');
const rebound = Domql.create(countQuery.definition, { panel: emptyPanel });

Domql.read(rebound);
// 0
```

The definition contains the query structure without bound values. `create` reuses it with new bindings and leaves the original query unchanged.

## The language

### Paths, operations and names

Paths follow members with a dot. Properties retain their declared spelling, such as `clientSize`. Operations use their declared lowercase names, such as `attribute-of`, `computedstyle-of` and `matches-media`. All DOMQL names are case-sensitive.

```js
Domql.read(Domql.parse('@panel.children.count', { panel }));
// 3

Domql.read(Domql.parse('@panel.get "children.count"', { panel }));
// 3

Domql.read(Domql.parse('@panel.is "attached"', { panel }));
// true
```

`get` reads a named member or path, `is` asks about a state or classification, and `has` asks about presence. The strings they interpret as DOMQL names are case-sensitive too. Selectors, attribute names and other strings passed to browser APIs follow the browser's own rules.

Arguments can use parentheses or, for simple literals and parameter references, whitespace:

```text
attribute-of("data-key")
attribute-of "data-key"
attribute-of @attributeName
```

Multiple bare arguments are separated by whitespace. Named arguments and expression arguments use parentheses. A following dot continues from the operation's result; use parentheses around an argument that itself follows a path. Commas separate shape fields and parenthesized arguments.

### Shapes and lists

A shape chooses output fields. An explicit alias controls the output name. Without an alias, the field uses the final member name; `get`, `is` and `has` infer the final segment of the name they select.

```js
Domql.read(Domql.parse(`
    @panel {
        count: children.count,
        is "attached",
        has "children",
    }
`, { panel }));
// { count: 3, attached: true, children: true }
```

Trailing commas, `//` line comments and `/* */` block comments are supported.

A shape following a list projects each item:

```js
Domql.read(Domql.parse(`
    @panel.all("[data-key]") {
        key: attribute-of "data-key",
        selected: matches "[aria-selected=true]"
    }
`, { panel }));
// [
//   { key: 'a1', selected: false },
//   { key: 'a2', selected: true },
//   { key: 'a3', selected: false }
// ]
```

A member following a list operates on the list itself. Use `count`, `first`, `last` and `at(index)` to inspect it, or `where`, `max`, `min` and `sum` with expressions evaluated against each item:

```js
Domql.read(Domql.parse(`
    @panel.all("[data-key]")
        .where(matches "[aria-selected=true]")
        .count
`, { panel }));
// 1

Domql.read(Domql.parse('@panel.all("[data-key]").max(rect.height)', { panel }));
// 64
```

`where` keeps items whose expression is true. `rect.height` is the height in CSS pixels of an element's border box, so the tallest item above is the 64px one. Aggregates skip null expression results. With no numeric results, `max` and `min` return null, while `sum` returns zero.

### Null and unavailable values

Null represents a missing or unavailable value; it does not hide an invalid query. A path or targeted shape whose receiver is null returns null.

```js
Domql.read(Domql.parse(
    '@panel.first(".missing").attribute-of "data-key"',
    { panel }
));
// null
```

Geometry such as `rect` and `size` is null when the element is detached or has no layout box, including when it or an ancestor has `display: none`. A measurable box with zero dimensions still returns those zero dimensions. Attachment and measurement availability are separate questions.

### Bind values explicitly

Bindings may contain elements or supported data. Use `Domql.bind(value, type)` when the value does not reveal its type, such as null, an empty list or a structure containing either. Declared types are checked against the supplied values; they do not convert them.

```js
const optional = Domql.parse(`
    {
        panel: @panel { size },
        ids: @ids
    }
`, {
    panel: Domql.bind(null, 'element?'),
    ids: Domql.bind([], 'list<number>')
});

Domql.read(optional);
// { panel: null, ids: [] }
```

Keep independent results in a top-level shape when one target may be null. Writing `@panel { size, ids: @ids }` instead would make the entire answer null while `panel` is null.

## API and errors

| API | Purpose |
| --- | --- |
| `Domql.parse(text, bindings)` | Construct a query from text. |
| `Domql.create(definition, bindings)` | Construct a query from a reusable definition. |
| `query.definition` | Access the immutable definition without its bound values. |
| `Domql.bind(value, type)` | Declare a binding's type explicitly. |
| `Domql.resolve(query, options)` | Check names and types without evaluating the query. |
| `Domql.read(query, window)` | Read once, optionally using an explicitly supplied window. |
| `Domql.createModule(name, contents, functions)` | Create an extension module. |
| `Domql.registerModule(module)` | Make a module available to query resolution. |

`resolve` checks a query without a browser and without reading anything:

```js
const resolved = Domql.resolve(Domql.parse('@panel.children.count', {
    panel: Domql.bind(null, 'element?')
}));

resolved.kind;            // 'query'
resolved.type.toString(); // 'number?'
```

Failures report a `DomqlError` with a `kind`, `message` and structured `location`. Locations identify text positions, definition nodes by JSON Pointer, or the relevant binding or declaration. Use the structured fields rather than matching error-message text.

| Kind | Failure |
| --- | --- |
| `syntax` | Invalid query text |
| `structure` | Invalid definition structure or binding |
| `validation` | Unknown members, incompatible types, invalid arguments or unsupported request usage |
| `module` | Invalid module declarations |
| `evaluation` | A failure while reading the query |

```js
try {
    Domql.read(Domql.parse('@panel.attribute-of 200', { panel }));
} catch (error) {
    if (error?.name !== 'DomqlError') {
        throw error;
    }

    console.error(error.kind, error.message, error.location);
    // validation
    // The argument 'name' of 'attribute-of' expects string and finds number
    // (line 1, column 21, at /query/arguments/0/value)
}
```

A misspelled operation is an error and a missing selector match is null. Raw elements are not valid answer data: `@panel.children` fails because its answer would hold elements, so project their properties with a shape.

## Environments

In a browser, DOMQL uses the default window and its document. To read against another supported DOM environment, pass its window to `Domql.read(query, suppliedWindow)`. Both `@window` and `@document` then refer to that environment. Node.js can run parsing and resolution; document reads require a supplied DOM environment, and reading without one fails with an `evaluation` error. DOM emulators do not provide full browser layout behavior.

## Extend the vocabulary

A module contributes declarations as data and the functions that implement them. The DOMQL name, public builder name and function key are independent. Functions for synchronous reads must be synchronous and read-only.

This example adds a `metrics` member to elements, exposing a child count:

```js
const metricsModule = Domql.createModule('metrics', {
    types: [{
        name: 'childMetrics',
        fields: { childCount: 'number' }
    }],
    members: [{
        name: 'metrics',
        builder: 'metrics',
        function: 'readMetrics',
        kind: 'property',
        on: 'element',
        parameters: [],
        result: 'childMetrics',
        changes: 'unobserved',
        reads: 'fresh'
    }]
}, {
    readMetrics: element => ({ childCount: element.children.length })
});

Domql.registerModule(metricsModule);

Domql.read(Domql.parse('@panel.metrics { childCount }', { panel }));
// { childCount: 3 }
```

The result can change, so it is not declared `constant`. This module supplies no change source and therefore declares `unobserved`: it supports reads, without promising watch support. Register a module once during setup, rather than before each read.

Modules can also declare event types, predicates and supported feature names. Declaring actions, behaviors or sources does not implement the runtime features listed as planned above.

## Learn more

- [Repository README](https://github.com/FormaUI/Forma.DOMQL): scope, build and test workflow, and the components to work in.
- [Language specification](https://github.com/FormaUI/Forma.DOMQL/blob/main/docs/domql-specification.md): syntax, types, null semantics and vocabulary contracts.
- [Runtime design](https://github.com/FormaUI/Forma.DOMQL/blob/main/docs/domql-design.md): resolution, evaluation, modules and planned watching and occurrence behavior.

The specification and design cover the intended system. Refer to the current capabilities above for what this package implements today.
