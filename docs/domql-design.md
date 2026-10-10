# DOMQL Design v1.0.8

The [DOMQL specification](domql-specification.md) defines the language. This design sets out how DOMQL runs and is used: how requests are built and prepared, how a read waits and a watch stays current, how results and changes are delivered, how occurrences hold their observations, and how modules extend the vocabulary.

This design describes the whole runtime. Reading a query once, watching it as snapshots or change sets, and subscribing to events are built; live state, actions and behaviors are not yet, and the [README](../README.md#status) states what this implementation covers.

## Scope

| Decision | Contract |
| --- | --- |
| A small language | Paths, shapes and lists, with literals and parameters. Arithmetic, conditions, ordering and anything else a query needs computed belongs to a member or to the caller. |
| An open vocabulary | Everything a query can ask about is a member a vocabulary contributes; the built-in vocabulary and every extension follow one contract, and adding a member leaves the grammar unchanged. |
| Queries read, requests act | Reading, watching or listening to a query reads the document and changes nothing, whatever vocabulary it uses; an action or a behavior request is a request of its own kind, carried out only when its caller runs or establishes it. |
| One meaning | A query evaluates the same way for every caller, however it was written. |
| Three ways in | A query is parsed from text, built fluently, or created from its JSON definition, and each produces a definition with the same meaning, validated and evaluated alike. |
| Visible mistakes | A misspelling or a wrong argument is an error before anything is evaluated; null is always a result. |

## Preparation

An extension a request names is loaded when the request is prepared, before it is first carried out, and preparation validates it against the vocabulary, as the specification sets out.

### Reading

A read resolves the query, then evaluates it once against the document in a single synchronous pass, following the resolution rather than looking names up again. A resolution is kept for its query, for the options it was made under and for the vocabulary it was made against, and is released with the query, so an unchanged query is resolved once however often it is read; what a read evaluates is always the document as it is. A read needs a browser window, the one it is given or the one the environment holds, and fails with an evaluation error where there is none, while parsing, creating and resolving need none. The result is a detached copy, frozen, that holds nothing of the document. A member whose function answers a type other than the one it declares has broken its contract, and the read fails with an evaluation error naming the member and where it stands in the query; so does a member whose function throws, with the thrown error as its cause. A member a module declares and does not implement fails the read the same way. A member maintained by an observation cannot be read in a single synchronous pass and fails it. A subscription, which ends in an occurrence source, is a request of another kind, and a read refuses it with a validation error once it is resolved, before anything is read; so do a watch of one, and a subscription to a query.

### Waiting for maintained members

A maintained member is pending until its first sample arrives, as the specification defines.

- **`readAsync`, and a watch's first snapshot,** wait for the first sample of every pending member they read, evaluating again as samples arrive, until an evaluation reads no pending member; only that result is delivered. The caller can cancel the wait, and a member that can produce no sample reports itself unavailable. The wait completes at the first evaluation that reads no pending member; dependencies that keep introducing pending members can keep it waiting until the caller cancels it.
- **A maintained member a watch first reads after its first snapshot** is pending in the snapshot the watch reports, and the watch evaluates again when its first sample arrives.
- **Inside an occurrence's shape,** a maintained member answers its latest sample, or null while pending, and is never waited for.

### Sessions

Every observation a query starts is reached through a session, which the query disposes when the read succeeds, fails or is canceled, when the watch or the subscription ends, and when an evaluation no longer depends on it. An observation already running for another query is reached through a session of its own, which leaves its lifetime to its other sessions; the last session to be disposed stops it. Equivalent requests share one observation where their type permits it; a request's identity is its type, its target, the arguments its type says belong to it, and the window it belongs to, so two requests that differ in an argument that changes what is observed, such as an intersection's root or margin, never share. A session gives its consumer the change notifications of the observation and, for a maintained observation, its latest sample, until the consumer disposes it. A session whose callback fails is reported and does not keep the others from hearing of a change.

## Watching and dependencies

A watch keeps a query's result current: it evaluates the query, reports a snapshot of the result, and evaluates again when something the result depends on changes, reporting only a snapshot that differs.

### Accepting partial observation

Accepting partial observation is an option of the watch, chosen when the caller establishes it, beside its schedule; it applies to that watch alone and leaves the query's meaning unchanged. A watch over a partly observable member without it is a validation error naming each such member and the changes its observations miss. A read needs no acceptance, since it keeps nothing current.

### Dependencies

A watch's dependencies are what its last evaluation actually read, recorded as it evaluated: each member applied to its receiver and arguments, with that member's observations. Dependencies belong to the complete query.

- **Every evaluation records its dependencies afresh,** and the watch subscribes to the observations the new set names and releases the ones it no longer names. What a watch observes therefore follows the document: in `@table.all("tbody tr").max(rect.height)`, the watch depends on what the selector matches within the table, and on the height of each row it matched. A row added starts being observed after the evaluation the addition causes, and a row removed stops being observed.
- **A value argument is a dependency of its own.** `@target.intersects(root: @panel)` depends on the intersection of the target with the panel; `intersects(root: parent)` also depends on which element is the parent, and a new parent is observed after the evaluation its change causes.
- **An expression argument contributes its dependencies for every item** it was evaluated against.
- **A path that met null depends on what it read before the null,** so `closest(".row")` finding nothing still depends on the ancestors it searched, and the watch evaluates again when one starts to match.
- **A watch keeps its bindings.** Binding different values starts the watch afresh.

Invalidation, evaluation and delivery each keep their own schedule. An observation invalidates the watch at once. The watch evaluates at the next animation frame, once however many observations fired, or immediately, in the task that reported the change, where its caller needs a change handled at the moment it is reported, such as at mutation delivery. When the caller receives the snapshot is the caller's own. Watches that depend on the same target through the same observation share one observation.

Evaluating the whole query each time is the design. A member may keep its result until its own observations fire, as long as the result is the one a full evaluation would give.

### Elements that leave the document

A member that answered null because its element is detached depends on whether that element is attached, so a watch reading it evaluates again when the same element returns to the document, and observes it again from that evaluation. Removing an element changes the results that read it, and a watch over them runs on until its caller ends it.

### When evaluation fails

A watch whose evaluation fails reports the error to its caller, and keeps the dependencies of its last successful evaluation together with those the failed one recorded before failing. It evaluates again when any of them changes or its caller refreshes it, and its next successful evaluation reports its snapshot whether or not it equals the last one reported.

### Cached state, change sets and snapshots

A watch keeps its result as cached state and hands its caller snapshots, change sets or live state:

| Concept | Is |
| --- | --- |
| Cached state | The watch's own copy of its result, updated in place as individual values change |
| Baseline | A complete result, establishing the state its receiver starts from |
| Change set | The fields and list entries that changed, relative to the receiver state it was computed against |
| Snapshot | An immutable result captured at one moment |
| Live state | A stable object a JavaScript caller holds, updated in place as the cached state is |

A snapshot never changes once delivered. A new snapshot reuses every immutable branch that did not change and builds new ones only along the paths that did, and a caller taking change sets receives no full snapshot after its baseline. Live state is the one value that changes under its holder: reading it at two moments can give two results, so it is chosen explicitly and is never a snapshot.

- **Baseline.** The first delivery is the complete result.
- **Change sets.** A change set is a [JSON Patch](https://www.rfc-editor.org/rfc/rfc6902) document limited to `replace`, `add`, `remove` and `move`, whose paths are JSON Pointers into the result; applying it to the state it was computed against gives the new result. A field the change set leaves out is unchanged, and a field that became null is replaced with null. A shape's fields are fixed, so `add` and `remove` apply to list items alone.
- **Lists.** A list whose items come from elements changes by element: an element entering is added, one leaving is removed, one changing position is moved, and one whose result changed is changed inside its item. Any other list changes by position.
- **Coalescing.** Pending changes combine into one change set, computed against the state the change set in flight establishes once accepted, so it carries everything since that one, and changes that cancel out send nothing.
- **Recovery.** Where the receiver's baseline cannot be trusted, after a failed delivery, a lost connection or a new target, the watch sends a fresh complete baseline.

Recovery abandons any delivery still unanswered and installs a fresh baseline, and nothing from before it can touch what follows:

1. **A change set applies only to the state it was computed against.** Its predecessor was accepted, or a recovery established a new baseline.
2. **Recovery invalidates older delivery work.** Once a recovery baseline is accepted, older pending changes and late completions update no state, advance no baseline and occupy no delivery slot.
3. **Applying a change set is atomic to consumers.** One that fails exposes no partial result, and the receiver resynchronizes from a fresh baseline.
4. **A failing handler leaves its state accepted.** It undoes no accepted change, and an accepted change set is never applied again.
5. **Coalescing keeps the receiver's chain of states.** A change set waiting behind one in flight is computed against the state that one establishes once accepted, and a delivery whose outcome is uncertain is followed by a fresh baseline.

Evaluating only what changed and delivering only what changed are separate: a watch that evaluates its whole query still delivers only the changes in its result.

### Delivering change sets

A watch delivers change sets when its caller chooses them as its update strategy, `updateStrategy: 'changeSet'`, which brings baselines, acknowledgment and recovery with it; it delivers each snapshot whole otherwise.

- **Identity.** A list projected from elements is matched by element, and two elements can project to the same data, so the identity of each item cannot be read back from a snapshot. Evaluation keeps the element each item came from as metadata beside the result, which the comparer and the change sets use and which neither a result nor a change set ever holds. A list that was not projected from elements, one with a null item, and one in which an element stands twice are matched by position.
- **What a change set reproduces.** A change set takes the accepted state to the reconciled snapshot, the one the watch reports, with every comparison and tolerance applied; it never describes a different, raw evaluation.
- **An update** names its generation, the revision it starts from and the revision it reaches, whatever carries it. A baseline starts a generation at revision 0 and carries the whole snapshot; a change set goes from one revision of its generation to the next and carries the patch.
- **Acknowledgment.** A current snapshot confirms that it applied an update by having its host acknowledge it on the watch. One update waits for acknowledgment at a time; while it waits, the watch keeps the latest snapshot, and once it is acknowledged it computes the next change set against the state that update established, so the changes since combine into one and changes that cancel out send nothing.
- **Recovery.** Where a current snapshot failed to apply an update, was lost or is new, its host recovers the watch, which abandons the generation, the update waiting in it included, and sends the watch's snapshot as the baseline of the next. A late update or acknowledgment of an abandoned generation changes neither the current snapshot's value nor the watch's bookkeeping.
- **The current snapshot** is DOMQL's, the receiving side a host creates: it applies an update atomically to the snapshot it was computed against, answers whether it accepted the update, found it stale or failed it, and leaves its value as it was where it fails. Its value is the snapshot last accepted, and every snapshot it held before stays unchanged. The host owns the transport between the watch and the current snapshot, and reports what the current snapshot answered. A callback that fails after the current snapshot accepted an update does not make the update failed.

### Comparing snapshots

A watch reports a snapshot that differs from the last one it reported, compared field by field and item by item. Strings, Booleans and null compare exactly; a number compares within the tolerance its member declares, and exactly where it declares none.

## Occurrence delivery

An occurrence's shape is evaluated as the specification defines, and its result, immutable data, reaches the caller by the caller's own delivery.

A maintained member in an occurrence's shape reads its latest sample, or null while it is pending, never waits for a later one and never revises a result already delivered:

```
@button.eventsOf("click") {
    nearEnd: @sentinel.intersects(root: @panel)
}
```

The subscription holds the sessions its shapes acquire. After each successful evaluation it keeps the sessions that evaluation read and disposes the rest, so an observation one occurrence started serves the next: the first occurrence reports null for a member still pending, and a later one reads the sample that arrived meanwhile. A failed evaluation delivers no result and reports its failure; the subscription keeps the sessions it held before it and disposes those the failed attempt acquired. Ending the subscription disposes every session it holds, and an observation another holder still has a session on runs on.

## Modules

An extension is registered as a module, which declares under its name the state members, occurrence sources, actions and behaviors it contributes and supplies the implementation that carries each out; requests resolve against those declarations. The declarations are data, each member's DOMQL name, signature, result type, argument types and kinds and the request kinds it supports, so they can be read without running the implementations. A module associates three things explicitly, and nothing derives one from another: an operation's DOMQL name, `computedStyleOf`, its public builder name, `computedStyle`, and the function that carries it out, whatever that function is called. A module registers under a name of its own, and registering a name twice is an error.

```js
Domql.registerModule(new VirtualizerDomqlModule(Virtualizer));
Domql.registerModule(new InputRouterDomqlModule(InputRouter));
```

### Declarations

A module is created with its members and, once it can carry them out, the functions they name; declarations are validated when the module is created and checked against the registry when it is registered. The built-in vocabulary is the module `builtIn`, whose identity no other module takes and whose members stand without a namespace; any other module adds members to its own types and a single member named for itself to any other.

- **A declaration** names the member's DOMQL name, which the fluent builder spells the same way, and the key of its function in the module's functions, independent of its name; its kind, one of property, operation, source, action and behavior; the types it applies to; its parameters; its result type; and its observation coverage.
- **A parameter** is a value or an expression. An expression is evaluated against each item of the list it follows and declares the type it produces. A parameter declares whether it is required, its default where it is not, and whether a null argument propagates, making the call answer null, or is accepted.
- **A fixed parameter** names something the vocabulary resolves before any evaluation, and declares what it selects: a member, a predicate, an occurrence or a feature.
- **Observations.** A member that changes observably or partly observably names the observations that cover its changes. An observation is of a type, observes the receiver, the window, the document or an argument of the member, and gives the arguments its type takes; a member that changes in any other way names none. A module declares a type of observation with the function that starts one. A type is either an invalidation observation, which says that a result may have changed and carries no value, or a maintained observation, which provides a sample a member reads and is pending until its first arrives; a member that reads maintained values names a maintained observation, and no other member does.
- **Types, events, predicates and features** are contributed by modules as data: structured types with their fields, event types with the type of their occurrences, predicates under `is` or `has` with the types they apply to, and the features `supports` names.
- **Observation coverage** states how a member changes (constant, observable, partly observable with the changes it misses, unobserved, or derived from its receiver and arguments) and how it reads (fresh, maintained, captured or derived).

A request is resolved with `Domql.resolve`, which resolves every member against the registry, types the result and records what each member resolved to, without a browser and without evaluating anything. A watch over a member that is unobserved is refused, and one over a partly observable member is refused unless it accepts partial observation.

A module is given the capability it exposes, never an instance of it, since instances belong to the callers that establish them. A module exposes a capability through DOMQL without the capability depending on DOMQL: the capability keeps an API of its own, and its module lives beside it or in an integration package for it.

- **The registry holds definitions.** One registry per document holds every registered module's declarations, shared by all its callers. The instances behaviors create, the subscriptions listening to them and the state of whoever established them are scoped to their callers, never to the registry.
- **Registering is not establishing.** Registering a module makes its capability understood; establishing one of its behaviors creates an instance for its caller and target. Releasing that instance leaves the module registered.
- **Loading follows requests.** A module is registered before a request naming it is prepared, by its caller or on demand by the caller's environment, so a request loads only the modules it names.

## Tooling

Preparation is authoritative: it validates every request against the vocabulary available before the request runs, whether text, a fluent builder or a definition produced it. Three properties keep validation open to editor tooling, such as analyzers and completion, which can follow without changing the language:

- **Locations.** Text positions and definition-node locations are kept, so a diagnostic names the member, argument or shape that failed; the mapping from text to definition can be kept apart from the definition.
- **Declarative metadata.** A module's declarations are data, so a tool understands them without running a capability's implementation.
- **Independent validation.** Structural and vocabulary validation run without a browser, given the metadata and the bindings' types.

A tool can check a query text known when the code is written against the metadata available to its project; text built at run time, modules registered at run time and checks that depend on bound values remain preparation's.

## Callers

A caller creates a request, binding its parameters, and then reads a query once or watches it, listens to a subscription, runs an action, or establishes, updates and releases a behavior; a watch's caller also chooses its schedule and whether it accepts partial observation. The request is prepared before it is first carried out. Each parameter is bound under the name the request uses, with a value the specification allows. A result is data, which a caller receives in its own language's form.

### Building a query

A query is parsed from text, built fluently, or created from a definition, and each produces a definition with the same meaning, prepared, validated and evaluated alike. A builder generates the names of the parameters it binds, so two equivalent definitions can name them differently; equivalence lies in their meaning and their results. Constructing a request describes work: it reads nothing in the document, starts no observation and makes no call across an interop boundary, and reading, watching, listening, running and establishing belong to the caller that carries it out. A definition created directly serves tooling and integrations. A call that resolves, reads, watches or listens takes a query or its text: given text, it parses it as `parse` does, through the same cache of parsed texts, with the parameters between the text and the options or the configuration, always in that place, so a request made once needs no query of its own and a query built once serves every call that reuses it. A query belongs to the instance of the library that made it, and an instance refuses another's query with an error that names how to reuse it. A page can hold several instances, as independently bundled libraries each carry their own, and a query passes between them as its definition and raw parameters, which the receiving instance validates and resolves against its own vocabulary; a typed binding passes as one that instance makes. The refusal decides ownership alone, and validation and resolution enforce the contracts a definition meets.

| JavaScript | C# | Meaning |
| --- | --- | --- |
| `Domql.parse(text, parameters)` | `Domql.Parse(text, parameters)`, `Domql.Parse<T>(text, parameters)` | Parses text into a query, binding its parameters |
| | `Domql.TryParse(…)`, `Domql.TryParse<T>(…)` | Parses text, answering false with a diagnostic and no query for text that does not follow the syntax or the structural rules |
| `Domql.from(target)` | | Starts building a query fluently at a target |
| `Domql.create(definition, parameters)` | `Domql.Create(definition, parameters)`, `Domql.Create<T>(definition, parameters)` | Creates a query from its definition, binding its parameters |
| `query.definition` | `query.Definition` | The query's definition, without its bound values |
| `Domql.registerModule(module)` | | Registers a module's declarations in the document's registry |

JavaScript builds fluently or parses text:

```js
// Fluently, from a target.
const panelState = Domql
    .from(panel)
    .select(view => ({
        size: view.size,
        hasFocus: view.matches(":focus-within")
    }));

// A collection, filtered and shaped.
const rows = Domql
    .from(table)
    .all("tbody tr")
    .where(row => row.intersects({ root: panel }))
    .select(row => ({
        key: row.attributeOf("data-key"),
        height: row.rect.height
    }));

// An aggregate.
const tallest = Domql.from(table).all("tbody tr").max(row => row.rect.height);

// From text, binding its parameters by name.
const parsed = Domql.parse(`
    @panel {
        size,
        hasFocus: matches(":focus-within")
    }
`, { panel });

// From a definition, bound to another panel; the text named the parameter `panel`.
const another = Domql.create(parsed.definition, { panel: otherPanel });
```

C# writes text, and names the type its result maps onto, or none:

```csharp
public sealed record PanelState(double? Width, bool? HasFocus);

DomqlQuery<PanelState> typed = Domql.Parse<PanelState>(
    """
    @panel {
        width: size.width,
        hasFocus: matches(":focus-within")
    }
    """,
    ("panel", panel));

DomqlQuery untyped = Domql.Parse("@panel { size }", ("panel", panel));
```

A binding whose value does not reveal its type, an unavailable element, an empty list or a list holding a null, supplies the type with it, and supplies it again through `Create`; a declared type must fit every part of the value, as the specification sets out.

```js
const query = Domql.parse('{ panel: @panel { size }, ids: @ids }', {
    panel: Domql.bind(null, 'element?'),
    ids: Domql.bind([], 'list<number>')
});

const another = Domql.create(query.definition, {
    panel: Domql.bind(otherPanel, 'element?'),
    ids: Domql.bind([1, 2], 'list<number>')
});
```

```csharp
DomqlQuery query = Domql.Parse(
    "{ panel: @panel { size }, ids: @ids }",
    ("panel", Domql.Bind(null, "element?")),
    ("ids", Domql.Bind(Array.Empty<int>(), "list<number>")));
```

With the bindings of the first example, the result is the following: a shape following the null `panel` is null, and `ids` is the empty list.

```json
{ "panel": null, "ids": [] }
```

A `DomqlQuery<T>` answers a `T`, mapped by its declared contract, which matches the result's fields to the constructor parameters of `T` by name regardless of case, so a field `nearend` fills a parameter `NearEnd`, and reports an ambiguity where two fields differ only in case, since DOMQL itself tells them apart; a `DomqlQuery` answers a `DomqlSnapshot` giving structured access to its values. C# has no fluent builder and no C# type standing for each vocabulary concept: a module contributes its declarations and implementations, and the text names what the query reads. A `TryParse` checks the syntax and the structural rules that need no vocabulary, an empty shape, a duplicate field and a reserved name among them; an expected failure there answers false with a diagnostic and no query, and a vocabulary failure, such as an unknown member, arrives when the query is prepared.

- **Targets.** `Domql.from(target)` starts a path at an element and binds it as a parameter the builder names, one parameter however often the same element is given; `Domql.document` and `Domql.window` start at the roots. An element or other value given as an argument is bound the same way. A caller rebinding a fluent query's definition takes the parameter names from that definition.
- **Members.** A member is a property, and a member taking arguments is a method: `view.size`, `row.attributeOf("data-key")`. A builder spells a member by its DOMQL name, `row.attributeOf("data-key")` and `view.computedStyleOf("--x")`, with no conversion, and apart from the function that carries it out: renaming that function never changes the builder, and the declaration is available when a fluent query is built, while the implementation loads when it is prepared. A plain object as the last argument gives arguments by name, as `{ root: panel }` does.
- **Shapes.** `select` adds a shape, from a projection that receives the current value and returns an object whose properties are the shape's fields, in order. An object nested in it is a shape following no value, `Domql.from` inside it starts a path at another target, and a literal is written `Domql.value("list")`. `Domql.select({ … })` is a shape at the top level, across targets.
- **Expression arguments.** A list member taking an expression, such as `where`, `max`, `min` or `sum`, takes a callback receiving the item.
- **Tests.** `view.is("attached")` and `view.has("children")` build a predicate test of the value they follow, and `Domql.and(…)` and `Domql.or(…)` combine names, so `view.is(Domql.or("disabled", "readOnly"))` is `is "disabled" or "readOnly"`.
- **Text and definitions.** Parsing and creating bind the parameters a text or a definition names, by name, and a definition serves any binding. A text is parsed once and kept.

### The fluent callback contract

A fluent callback runs once, as the query is built, against recording descriptors: a member access or a supported call builds a definition node, a projection object describes a shape, and `Domql.value(…)` is an explicit literal. It never runs against a live element, so native control flow over a descriptor decides nothing about the document:

```js
// Unsupported: the conditional runs while the query is built.
Domql.from(viewport).select(view => ({
    width: view.is("attached") ? view.size.width : Domql.value(0)
}));
```

`view.is("attached")` is a descriptor, which JavaScript treats as truthy, so the first branch is recorded as though it were the whole expression. The builder's guarantee is bounded to what it can detect:

- It refuses converting a descriptor into a number or a string, so arithmetic, concatenation and ordering comparisons fail as the query is built.
- It accepts a projection field only as a descriptor, a nested shape or a `Domql.value` literal, which catches `!` and `===`.
- `&&`, `||`, `?:` and other native branching over descriptors are unsupported, and not every use of them can be detected.

Any builder constructs the definition directly, never text for the parser to read again.

