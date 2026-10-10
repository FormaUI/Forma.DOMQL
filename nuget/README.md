# DOMQL

> **Preview, not yet published to NuGet.** The package `formaui-net.DOMQL` is not on NuGet yet. Build it from the [repository](https://github.com/FormaUI/Forma.DOMQL#development) to try it, as [Install and load](#install-and-load) shows.

DOMQL is a small, extensible query language for reading DOM state as plain data. Describe what you need, and receive a snapshot shaped by your query.

The `formaui-net.DOMQL` NuGet package supplies the JavaScript library as a single minified ES module at `_content/domql/domql.js`. It can be used by applications and libraries. The API documented here runs in JavaScript.

## Current capabilities

Available now:

- Parse query text or create queries from JSON definitions.
- Validate structure, bindings, vocabulary names and types.
- Resolve queries without reading the DOM.
- Perform synchronous one-shot reads and receive immutable data snapshots.
- Wait for values the browser keeps, such as `intersects`, with `readAsync`.
- Watch a query and receive a snapshot each time its result changes.
- Subscribe to events and receive the projection of each one.
- Extend the vocabulary through modules.

Actions and behaviors are planned. A vocabulary declaration alone does not make those runtime capabilities available.

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
            key: attributeOf "data-key",
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

`@panel` refers to the supplied binding; it is not an ID lookup. `parse` constructs the query without reading the DOM. `read` resolves it as needed and returns the current result synchronously. The snapshot is immutable and contains no live element references.

For a query used once, `resolve`, `read`, `readAsync`, `watch` and `subscribe` also take its text and bindings directly, with any options or configuration after them: `Domql.read('@panel.children.count', { panel })`. The text is parsed the same way, through the same cache; parse a query yourself to reuse it. The bindings always come second, so a text without any passes `{}` before a configuration: `Domql.watch('@window.size', {}, { onChange: size => render(size) })`.

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

A query belongs to the DOMQL instance that created it. A page holds more than one instance when independently bundled libraries each include DOMQL, and an instance refuses another's query with an error saying how to reuse it: pass its definition and a plain object of bindings to `create`, as in `Domql.create(otherQuery.definition, { panel })`. The receiving instance validates the definition and resolves it against its own vocabulary, so a member another instance registered is unknown to it. Bind raw values, or typed bindings this instance makes with `Domql.bind`.

## Wait for values the browser keeps

Some values come from a browser observation, such as whether an element intersects the viewport. `read` refuses them, since their first sample cannot arrive during a synchronous read; `readAsync` waits for it:

```js
const inView = await Domql.readAsync('@panel.intersects', { panel });
// true
```

`readAsync` takes a `signal` to cancel the wait, reads a query with no such value as well, and lets go of every observation it started when it answers, fails or is canceled.

## Watch a query

`watch` keeps a query's result current: `onChange` receives a snapshot, then a new one each time the result changes. Here it watches the empty panel bound above:

```js
const watch = Domql.watch(rebound, {
    onChange: count => console.log(count)
});

await watch.refreshAsync();
// 0

emptyPanel.append(document.createElement('div'));
await watch.refreshAsync();
// 1

watch.dispose();
```

A watch evaluates again on its own at the next animation frame after something it reads changes. `refreshAsync` evaluates now and settles once the snapshot has been handed to `onChange`, which is how the example waits between its steps. `dispose` ends the watch and lets go of its observations. Pass `onError` to hear of a failed evaluation or a failing callback; the watch keeps running.

## Subscribe to events

`subscribe` evaluates the shape that follows an occurrence source, such as `eventsOf`, for each event, and hands `onEvent` the result:

```js
const clicks = Domql.subscribe(`
    @panel.eventsOf("click") {
        key: target.closest("[data-key]").attributeOf("data-key")
    }
`, { panel }, {
    onEvent: click => console.log(click.key)
});

panel.querySelector('[data-key="a2"]').click();
// 'a2'

clicks.dispose();
```

The shape reads what the event carried, such as its `target`, `button` or `clientX`, and anything else a parameter reaches, at the moment the event is dispatched. The event listener it answers starts listening in the call, observes events as they reach the receiver and leaves their course to the page. A value the browser keeps, such as `intersects`, is null until the browser first reports it, and is never waited for. Pass `onError` to hear of a failed projection or a failing callback; the event listener keeps listening until `dispose` ends it.

## The language

### Paths, operations and names

Paths follow members with a dot. Properties and operations are named in camelCase, such as `clientSize`, `attributeOf`, `computedStyleOf` and `matchesMedia`, and a member has the same name wherever it is written. All DOMQL names are case-sensitive.

```js
Domql.read(Domql.parse('@panel.children.count', { panel }));
// 3

Domql.read(Domql.parse('@panel.get("children.count")', { panel }));
// 3

Domql.read(Domql.parse('@panel is "attached"', { panel }));
// true
```

`get` reads a named member or path. `is` asks about a state or classification and `has` about presence: they are operators that test the value before them against predicates the vocabulary registers, and `and` and `or` combine names under one verb:

```text
@input is "disabled" or "readOnly"
@input is "disabled" or ("readOnly" and "textEditable")
@panel has "children"
```

`and` binds tighter than `or`, parentheses group, and a test stops reading predicates once its result is decided. Inside a shape or an expression, a test without a value before it tests the current value, as `where(is "disabled")` does. The strings that name members and predicates are case-sensitive too. Selectors, attribute names and other strings passed to browser APIs follow the browser's own rules.

After a dot, arguments are enclosed in parentheses. A member that starts a path, inside a shape or an expression, can take simple literals and parameter references without them:

```text
@panel.attributeOf("data-key")
attributeOf "data-key"
attributeOf @attributeName
```

Multiple bare arguments are separated by whitespace. A member written that way ends its path; to continue from its result, use parentheses, as in `first(".row").rect.height`. Named arguments and expression arguments use parentheses. Commas separate shape fields and parenthesized arguments.

### Shapes and lists

A shape chooses output fields. An explicit alias controls the output name. Without an alias, the field uses the final member name; `get` and a test of one name infer the final segment of the name they read, and a test that combines names or takes one from a parameter needs an alias.

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
        key: attributeOf "data-key",
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
    '@panel.first(".missing").attributeOf("data-key")',
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

Keep independent results in a top-level shape when one target may be null. Writing `@panel { size, ids: @ids }` instead would make the entire result null while `panel` is null.

## API and errors

| API | Purpose |
| --- | --- |
| `Domql.parse(text, bindings)` | Construct a query from text. |
| `Domql.create(definition, bindings)` | Construct a query from a reusable definition. |
| `query.definition` | Access the immutable definition without its bound values. |
| `Domql.bind(value, type)` | Declare a binding's type explicitly. |
| `Domql.resolve(text, bindings, options)`, `Domql.resolve(query, options)` | Check names and types without evaluating the query. |
| `Domql.read(text, bindings, options)`, `Domql.read(query, options)` | Read once, optionally using an explicitly supplied `window`. A member kept by an observation, such as `intersects`, fails it. |
| `Domql.readAsync(text, bindings, options)`, `Domql.readAsync(query, options)` | Read once, waiting for the first sample of every member kept by an observation. Returns a promise; `signal` cancels it, and the `window` is optional. |
| `Domql.createModule(name, contents, functions)` | Create an extension module. |
| `Domql.watch(text, bindings, configuration)`, `Domql.watch(query, configuration)` | Keep a query's result current: `onChange` receives a snapshot, then each snapshot that differs. Returns a handle with `status`, `lastSnapshot`, `refreshAsync()` and `dispose()`. |
| `Domql.subscribe(text, bindings, configuration)`, `Domql.subscribe(query, configuration)` | Subscribe to an event source: `onEvent` receives each projected result, evaluated as the event is dispatched. Returns an event listener with `status` and `dispose()`. |
| `Domql.createSnapshot()` | Create the current snapshot a watch with `updateStrategy: 'changeSet'` builds: `apply(update)` applies a baseline or a change set atomically and answers `accepted`, `stale` or `failed`, which the host reports to the watch through `acknowledge(update)` or `recover()`, and `value` is the snapshot last accepted. |
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
    Domql.read(Domql.parse('@panel.attributeOf(200)', { panel }));
} catch (error) {
    if (error?.name !== 'DomqlError') {
        throw error;
    }

    console.error(error.kind, error.message, error.location);
    // validation
    // The argument 'name' of 'attributeOf' expects string and finds number
    // (line 1, column 20, at /query/arguments/0/value)
}
```

A misspelled operation is an error and a missing selector match is null. Raw elements are not valid result data: `@panel.children` fails because its result would hold elements, so project their properties with a shape.

## Environments

In a browser, DOMQL uses the default window and its document. To read against another supported DOM environment, pass its window to `Domql.read(query, { window: suppliedWindow })`. Both `@window` and `@document` then refer to that environment. Node.js can run parsing and resolution; document reads require a supplied DOM environment, and reading without one fails with an `evaluation` error. DOM emulators do not provide full browser layout behavior.

## Extend the vocabulary

A module contributes declarations as data and the functions that implement them. A member's DOMQL name and the key of its function are independent. Functions for synchronous reads must be synchronous and read-only.

This example adds a `metrics` member to elements, exposing a child count:

```js
const metricsModule = Domql.createModule('metrics', {
    types: [{
        name: 'childMetrics',
        fields: { childCount: 'number' }
    }],
    members: [{
        name: 'metrics',
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

The result can change, so it is not declared `constant`. This module names no observation and therefore declares `unobserved`: it supports reads, without promising watch support. Register a module once during setup, rather than before each read.

Modules can also declare event types, predicates, supported feature names and occurrence sources. A source's function takes the receiver, the arguments, the environment and the function it delivers each occurrence to, and answers an object whose `stop` ends the listening; each occurrence is captured as the fields its event type declares. Declaring actions or behaviors does not implement the runtime features listed as planned above.

## Learn more

- [Repository README](https://github.com/FormaUI/Forma.DOMQL): scope, build and test workflow, and the components to work in.
- [Language specification](https://github.com/FormaUI/Forma.DOMQL/blob/main/docs/domql-specification.md): syntax, types, null semantics and vocabulary contracts.
- [Runtime design](https://github.com/FormaUI/Forma.DOMQL/blob/main/docs/domql-design.md): resolution, evaluation, modules, watching and subscribing to events.

The specification and design cover the intended system. Refer to the current capabilities above for what this package implements today.
