# DOMQL

DOMQL is a small, extensible query language for reading DOM state as plain data. Describe what you need from elements, collections and the browser, and receive an immutable snapshot shaped by your query.

Combine measurements, attributes, selection state and collection summaries in one query. Reuse that query as the document changes, or bind it to different elements.

## How DOMQL differs from jQuery

jQuery gives JavaScript code methods for selecting elements, reading and changing the DOM, and handling events. To collect several facts into a result, your code calls those methods and assembles the data.

DOMQL is a declarative language and a runtime for carrying out its requests. A query describes the values to read and the shape of the result. The runtime checks it against a typed vocabulary, evaluates it and returns an immutable snapshot of plain data.

For example, given a panel whose items have layout boxes, both examples read each item’s key, height and selection state:

```js
const panel = document.getElementById('panel');

// jQuery: the callback reads the values and constructs each object.
const items = $(panel).find('[data-key]').map((_, item) => ({
    key: $(item).attr('data-key'),
    height: item.getBoundingClientRect().height,
    selected: $(item).is('[aria-selected=true]')
})).get();
```

```js
// DOMQL: the query describes the values and each object's shape.
const items = Domql.read(`
    @panel.all("[data-key]") {
        key: attributeOf "data-key",
        height: rect.height,
        selected: matches "[aria-selected=true]"
    }
`, { panel });
```

`@panel` refers to the supplied element; it is not an ID selector. If an item has no layout box, DOMQL reports its height as `null`.

A DOMQL request can be written as text, built fluently or created from a JSON definition. All three forms use the same language and vocabulary rules. Constructing a request does not evaluate it against the DOM: the same query can be read repeatedly, watched for changes or recreated with different bindings.

The runtime also supports subscriptions that project events into data, actions that run once, and behaviors that remain active until disposed. Actions and behaviors are supplied by extension modules. Queries remain read-only.

| | jQuery | DOMQL |
| --- | --- | --- |
| Main abstraction | A collection of elements with methods your code calls | A typed request whose definition the runtime carries out |
| Reading data | Your code reads values and constructs a result | A query specifies the values and result shape |
| Read result | Whatever your code constructs | An immutable snapshot without live DOM references |
| Validation | JavaScript calls, with checks available through tooling | Request structure, vocabulary names and types checked before evaluation |
| Keeping data current | Your code chooses when to repeat its reads | A watch tracks dependencies and reports changed results as snapshots, change sets or live state |
| Events | Handlers receive events and perform your logic | Subscriptions project occurrences into plain data |
| Changing the page | DOM manipulation methods | Separate action and behavior requests supplied by modules |
| Extension | Plugins add methods | Modules declare typed capabilities and their implementations |
| Reuse | Functions encapsulate operations | Definitions can be reused with new bindings, stored or transmitted as JSON |

Watching follows the observation coverage declared by the vocabulary. Some members are only partly observable and require `acceptPartialObservation: true`; changes outside that coverage need an explicit refresh. Live state is updated in place, while snapshots preserve earlier results.

The [specification](docs/domql-specification.md) defines the language, types and vocabulary contracts.

## From the DOM to a snapshot

Suppose a panel contains three items:

```html
<div id="panel">
    <div data-key="a1" style="height: 48px"></div>
    <div data-key="a2" style="height: 64px" aria-selected="true"></div>
    <div data-key="a3" style="height: 48px"></div>
</div>
```

You want the panel’s item count, each item’s height and selection state, the selected items, and the tallest item.

Describe that answer in DOMQL:

```js
import { Domql } from './src/domql.js';

const panel = document.getElementById('panel');

const query = Domql.parse(`
    @panel {
        count: children.count,

        items: all("[data-key]") {
            key: attributeOf "data-key",
            height: rect.height,
            selected: matches "[aria-selected=true]"
        },

        selected: all("[data-key]")
            .where(matches "[aria-selected=true]") {
                key: attributeOf "data-key"
            },

        tallest: all("[data-key]").max(rect.height)
    }
`, { panel });

const snapshot = Domql.read(query);
```

With the markup above rendered without additional styling, the result is:

```json
{
    "count": 3,
    "items": [
        { "key": "a1", "height": 48, "selected": false },
        { "key": "a2", "height": 64, "selected": true },
        { "key": "a3", "height": 48, "selected": false }
    ],
    "selected": [
        { "key": "a2" }
    ],
    "tallest": 64
}
```

The query describes the answer directly:

- `@panel` refers to the element supplied in the bindings.
- Paths such as `rect.height` read members.
- Shapes choose fields and their output names.
- A shape after a list projects each item.
- `where` filters items, and `max` evaluates an expression across them.

The result contains data, not live DOM references. You can retain it, serialize it or pass it to another part of your application.

## Write once, read again

Parsing constructs the query without reading the document, so one query serves every read. Take the `query` and the `snapshot` from the example above. When the document changes, read the same `query` again to get a snapshot of its new state. Here the panel's first item becomes selected:

```js
// Access the panel's first item and select it.
panel.children[0].setAttribute('aria-selected', 'true');

// Read the query from the first example.
const next = Domql.read(query);

console.log(next.selected);
// [{ key: 'a1' }, { key: 'a2' }]

console.log(snapshot.selected);
// [{ key: 'a2' }]
```

The new snapshot, `next`, holds both selected items. `snapshot`, the first example's, was read before the change and still holds only `a2`: earlier snapshots remain unchanged. Compatible name and type resolutions are reused between reads; DOM values are read again.

The same definition can also be bound to another target:

```js
const anotherQuery = Domql.create(query.definition, {
    panel: anotherPanel
});

const anotherSnapshot = Domql.read(anotherQuery);
```

## Keep a query current

Reading again by hand is not always what you want. Watch the query, and DOMQL evaluates it again whenever something it depends on changes. `render` stands for whatever your application does with a snapshot:

```js
const watch = Domql.watch(query, {
    acceptPartialObservation: true,
    onChange: snapshot => render(snapshot)
});
```

Members such as `all`, `rect` and `matches` can miss some changes, such as pointer state or a transform, so a watch over them says it accepts that. Without it, DOMQL refuses the watch and names each member and what it misses.

`onChange` receives the first snapshot right after `watch` returns, then a new one each time the result changes, evaluated at most once per animation frame. A snapshot that did not change is not delivered, and a new one shares every part that did not change with the one before it.

A watch follows the document rather than a fixed set of elements: it observes what the query reads now, so an item added to the panel is watched from the next evaluation on. Change the document, and the watch delivers the new snapshot to `render`:

```js
// Access the panel's first item and select it.
panel.children[0].setAttribute('aria-selected', 'true');

// The watch notices, evaluates the query again at the next animation frame
// and calls render with a snapshot whose `selected` holds a1 and a2.
```

Pass `onError` to hear of a failed evaluation or a failing callback; the watch keeps running. `watch.status` and `watch.lastSnapshot` say where it stands, `await watch.refreshAsync()` evaluates now, and `dispose()` ends it and releases its observations:

```js
watch.dispose();
```

## Read across targets

A query can combine independent targets and browser state into one answer:

```js
const surroundings = Domql.parse(`
    {
        panel: @panel {
            size,
            hasFocus: matches ":focus-within"
        },

        window: @window {
            size,
            dark: matchesMedia "(prefers-color-scheme: dark)"
        },

        visible: @document is "visible"
    }
`, { panel });

const state = Domql.read(surroundings);
```

Use this to assemble the state a component needs without maintaining a separate JavaScript function for every result shape.

## Read now or wait for an observation

`read` returns synchronously for queries that read fresh values.

Some values, such as an observed intersection, require a browser observation to provide its first sample. Use `readAsync` for these queries:

```js
const sentinel = document.getElementById('sentinel');
const controller = new AbortController();

const sentinelQuery = Domql.parse(`
    @sentinel.intersects(root: @panel, margin: 200)
`, { sentinel, panel });

const nearEnd = await Domql.readAsync(sentinelQuery, {
    signal: controller.signal
});
```

`readAsync` also supports queries containing only fresh values. It releases its observation sessions when the read completes, fails or is canceled.

## Extend the vocabulary

DOMQL separates the language from the concepts it can read.

Modules declare their members, types and arguments, and supply the functions that implement them. A module can expose an application’s own state or integrate a browser capability without adding syntax to the language.

Queries are checked against those declarations. Unknown members and incompatible arguments are errors; unavailable values are represented by null.

DOMQL is independent of any UI library and can be used by other libraries and applications.

See the [library guide](nuget/README.md) for module registration, binding types, null behavior and the complete public API.

## Status

DOMQL is in preview and is not yet published to npm or NuGet.

Available today:

- Text queries, JSON definitions and queries built fluently, with the result type inferred in TypeScript.
- Binding, name and type validation.
- Synchronous reads and asynchronous reads of maintained values.
- Watching a query, with a snapshot each time its result changes, a baseline and then change sets, or one object kept current in place.
- Subscribing to events, with the projection of each one.
- Running actions once, and activating behaviors that stay in effect until disposed.
- Immutable snapshots.
- Extensible vocabulary and observation types.
- TypeScript declarations.

C# integration is planned. The [implementation plan](docs/domql-implementation-plan.md) tracks their progress.

## Build and try it

Clone the repository and run:

```powershell
./build.ps1
```

To include the real-browser tests:

```powershell
./build.ps1 -Browser
```

To build the NuGet package locally:

```powershell
./publish.ps1
```

The package is written to `artifacts/`. It supplies the JavaScript bundle at `_content/domql/domql.js`, with its TypeScript declarations alongside it.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and contribution guidance.

## Documentation

- [Library guide](nuget/README.md) — loading DOMQL, using its API and extending it.
- [Language specification](docs/domql-specification.md) — syntax, types and vocabulary contracts.
- [Runtime design](docs/domql-design.md) — resolution, evaluation, watching, subscribing to events and observation sessions.
- [Implementation plan](docs/domql-implementation-plan.md) — completed work and upcoming capabilities.

## License

[Apache-2.0](LICENSE).
