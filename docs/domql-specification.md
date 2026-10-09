# DOMQL Specification v1.0.3

DOMQL is a small language for querying the DOM: a query names what its caller wants to know about a document and its elements, and evaluating it gives one answer shaped the way it asked. The same query is read once, watched for changes, or evaluated at each occurrence of something that happened in the document, and the actions and behaviors a caller asks the browser for are requests of their own kinds. The language knows how to name values and shape answers; what can be asked about, an element's size, a computed style, whether it matches a selector, comes from a vocabulary beside it, so adding to what can be asked never changes the language.

This specification defines the language: its syntax, what each request means, the contracts of its vocabulary and the definition every request has. The [DOMQL design](domql-design.md) sets out how requests are built, prepared and carried out.

This specification describes the whole language. An implementation may cover part of it; the [README](../README.md#current-scope) states what this one implements.

## Terms

A **query** is a value expression whose evaluation produces an **answer**. A **path** starts from a value and follows **members**; a member belongs to a **type**, such as an element, a list or a rectangle, and can take **arguments**. A **shape** names the **fields** an answer holds, each with a value. A **parameter** is a value the caller supplies under a name, such as an element. A **vocabulary** is a set of types and their members; the **core vocabulary** comes with DOMQL, and an **extension** is a vocabulary registered under a name of its own. An **occurrence source** is a member whose value is a stream of occurrences, things that happened, rather than state. An **action** is an operation the browser carries out once, and a **behavior** one that runs on until it is updated or released; a **request** is a query, a subscription, an action or a behavior request. A query's **definition** is the JSON document recording its meaning, and every request has one.

## Syntax

```
query     = value
value     = start { "." member | shape }
start     = parameter | member | literal | shape
parameter = "@" name
member    = name [ "(" [ argument { "," argument } [ "," ] ] ")" | simple { simple } ]
simple    = literal | parameter
argument  = [ name ":" ] value
shape     = "{" [ field { "," field } [ "," ] ] "}"
field     = [ name ":" ] value
literal   = string | number | "true" | "false" | "null"
```

A name is a letter followed by letters and digits, with single hyphens allowed between them, as in `matches-media`. `true`, `false` and `null` are reserved literal tokens and cannot be used as names; the restriction applies equally to text queries and to definitions created directly, wherever a name is declared or supplied: a member, a parameter, a field's name, a named argument, and an extension's or a predicate's declaration. A string holding one of them stays an ordinary string, so `attribute-of "null"` reads the attribute named `null`. `document` and `window` name the roots, and no parameter can take either. They are ordinary names everywhere else, so `window: @window { size }` names a field `window`. A string is double-quoted, with `\"` and `\\` as its escapes. A number is written as in JSON. Commas separate a shape's fields and a member's arguments, and a trailing comma after the last is allowed; whitespace, line breaks included, separates anything else. Outside a string, `//` starts a comment that runs to the end of its line, and `/*` starts one that runs to the next `*/`, across lines; a block comment does not nest, so the first `*/` closes it, and one never closed is a syntax error. Inside a string both are text, so `"https://example.com"` and `"/* */"` read as written.

```
@viewport {
    // The viewport's width, and whether focus is within it.
    width: rect.width,
    hasFocus: matches(":focus-within"),
    columns: all("[data-column]") { key: attribute-of("data-column"), width: rect.width }
}
```

Arguments are given by position first, then by name; a member's signature names its parameters, and positional arguments bind to them in order.

A member followed by literals and parameters, without parentheses, receives them as its arguments in order, so `is "attached"`, `attribute-of "id"` and `@sentinel.intersects @panel 200` are `is("attached")`, `attribute-of("id")` and `@sentinel.intersects(@panel, 200)`, with the same definitions. They are separated by whitespace, line breaks included, and the commas that separate a shape's fields still end them: `{ nearEnd: @sentinel.intersects @panel 200, visible: @document.is "visible" }` has two fields. A dot after them continues from the call's result, not from the last argument: `closest ".row".attribute-of "id"` is `closest(".row").attribute-of("id")`, and `intersects @panel.parent` is `intersects(@panel).parent`. Named arguments and any argument that is more than a literal or a parameter take parentheses, as `intersects(root: @panel, margin: 200)`, `max(rect.height)` and `where(is "textEditable")` do, which also keeps it plain which operation an argument belongs to. The boundaries are decided by the text alone, never by how many arguments an operation expects, so the grammar needs no vocabulary and every member of every vocabulary takes it alike.

## Names and resolution

A path is evaluated against a **current value**. A bare name is always a member of the current value, and a name starting with `@` is always a parameter, so a reader never has to guess which it is.

- **At the top level** there is no current value, so a query starts with a parameter, a literal or a shape.
- **Inside a shape**, the current value is the value the shape follows: in `@viewport { rect.width }`, `rect` is the viewport's. A shape at the top level, `{ anchor: @anchor.rect, open: @popup.matches(":popover-open") }`, has no current value, so each of its fields starts with a parameter, a literal or a shape.
- **A shape following no value** keeps the current value around it, so it groups fields: in `@panel { layout: { width: size.width, height: size.height } }`, `size` is the panel's. At the top level that value is absent.
- **Parameters** resolve the same way everywhere, inside shapes and arguments alike. A parameter's value is an element, or data: a number, a string, a Boolean, null, a list or an object, as a behavior's configuration is, and a list or an object can hold elements.
- **The roots** are predefined parameters: `@document` is the document and `@window` is the browser window, its layout viewport and what it supports. A supplied parameter cannot take either name.

### Arguments

Every parameter of a member is declared as one of two kinds, and the evaluator treats them differently.

- A **value argument** is evaluated once, where the call is written, against the same current value as the path it appears in. In `@viewport { first(".item").intersects(root: parent) }`, `parent` is the viewport's parent, not the item's. At the top level, where there is no current value, a value argument starts with a parameter, a literal or a shape: `@target.intersects(root: @target.parent)`.
- An **expression argument** is evaluated by the member against a context the member's signature declares, such as each item of a list. In `@table.all("tbody tr").max(rect.height)`, `rect` is each row's.

A value argument can be declared **fixed**, where it selects something validation needs before evaluation, such as the event type whose members `events-of` offers, the feature `supports` names, the predicate `is` and `has` take or the member `get` reads. A fixed argument is a literal or a bound parameter, whose value is settled when the query is prepared; any other value is a validation error.

Because the kind is part of the signature, the evaluator validates every kind before evaluation and records the dependencies of value and expression arguments while it evaluates.

### Case-sensitive names

Every name in DOMQL is case-sensitive, and nothing normalizes one: `size` and `Size` are different names, and so are `@panel` and `@Panel`. A name is resolved exactly as it is written, and each kind of name is spelled by its own convention:

- **Operations** are named in lowercase kebab-case: `matches-media`, `attribute-of`, `events-of`.
- **Properties** keep their declared spelling: `size`, `clientSize`, `grid.columns`. `get "clientSize"` reads that property by the same name.
- **Predicates** keep their declared spelling, which `is` and `has` read from a string: `is "readOnly"`, `is "scroll.atEnd"`.
- **Aliases and bindings** keep the exact spelling their author gave them, so `hasFocus` and `hasfocus` are two fields, and a binding `panel` is not a binding `Panel`.
- **Strings** are preserved exactly: `kind: "List"` answers `List`. A string is read as a DOMQL name only where a member interprets it as one, as `get`, `is` and `has` do, and it is then read exactly. A value passed to a browser API, such as a selector, an attribute's name or value, or an event type, follows that API's own case rules.

A field without a name of its own takes the name of the member or segment it reads, in its declared spelling, so `size` answers the field `size` and `get "clientSize"` the field `clientSize`. An alias answers the key it was written as, and how a consumer matches keys to its own members is its own: a consumer that cannot tell `hasFocus` from `hasfocus` reports the ambiguity, and the language is unaffected. How a module names an operation in DOMQL, and which function carries it out, is the module's declaration.

## Values

A value is a number, a string, a Boolean, null, a list, a structured value such as a rectangle, an element, the window, the document, or an occurrence source. A member's signature declares its result type, as the section on types sets out, and a result marked `?` can be null by itself; any member answers null when its receiver or an argument is null and its parameter propagates null.

An answer is data: numbers, strings, Booleans, null, lists and shaped objects. An element or an occurrence source has no data form, so a query whose answer would contain one is a validation error; a query shapes an element into the facts it needs.

### Shapes

- A field takes the name given before its colon, or, with none, the name of the last member in its path, so `rect.width` is `width` and `all("tr") { … }` is `all`; a `get`, `is` or `has` takes the name of the last segment of the name it reads, as the section on reading by name sets out, so `is "disabled"` is `disabled`, `has "children"` is `children` and `is "scroll.atEnd"` is `atEnd`.
- A field whose path follows no member, a parameter, a literal or a shape on its own or followed by a shape, has no name to take and requires one.
- Two fields of one shape with the same name are an error when the query is created, and so is an empty shape.
- An answer keeps its fields in the order the shape names them.
- A shape following null is null.

### Lists

- A shape following a list applies to each item and answers a list of the same length, in the same order; an item that is null answers null at its position.
- A member following a list is a member of the list itself: `all("tr").count` counts rows.
- `count` of an empty list is 0, and `sum` is 0. `max` and `min` of an empty list are null.
- `max`, `min` and `sum` take a number expression, skip items whose expression is null, and answer null for `max` and `min` when every item was skipped.
- `where` takes a Boolean expression and keeps the items it is true for, leaving out an item whose expression is null; an expression of any other type is a validation error.
- `first`, `last` and `at` answer null when the list has no such item.

CSS selectors and `where` are the two ways a query filters: a selector chooses elements as the browser matches them, and `where` chooses list items by any Boolean the vocabulary offers.

## Types

A value has a type, and every member declares the types it works with. Type checking is part of preparation: a request that cannot be typed is a validation error naming where it fails, the type it expected and the type it found, before anything is evaluated.

The types are `number`, `string`, `boolean`, `element`, `window` and `document`; `list<T>` of items of type `T`; the structured values, each with named fields of declared types, such as `rectangle`, `size` and `selection`, the shapes a query itself creates, and any a module declares; and `occurrence<T>`, an occurrence source whose occurrences are of type `T`. A module can declare types of its own. `null` is a value of every type that is written with a `?`: `T?` is a `T` or null.

### What a member declares

A member's signature declares its receiver type, then each parameter's order, name, type, whether it is required or what it defaults to, and how it handles null, and its result type. Optional and nullable are separate: an optional parameter may be omitted, and a nullable one may be given null. Unless a table marks a parameter optional, it is required: omitting a required argument is a validation error, and supplying null follows its declared null policy. It is only part of the member's contract: the member also declares its evaluation context, how it changes and how it reads, and the request kind it belongs to. A parameter is a value argument or an expression argument, and an expression argument declares the type of the item it is evaluated against and the type it must produce:

- `list<T>` keeps `T` through `where`, `at`, `first` and `last`.
- `where` evaluates its expression against a `T` and requires a `boolean?`.
- `max`, `min` and `sum` evaluate their expression against a `T` and require a `number?`.

These expressions declare a nullable result because they consume null per item instead of propagating it to the whole call: `where` leaves out an item whose expression is null, `max` and `min` skip it and answer null when every item was skipped, and `sum` skips it and answers zero when every item was skipped or the list is empty. So `@table.all("tbody tr").max(rect.height)` and `@panel.all("[data-key]").where(intersects(root: @panel))` are valid although `rect.height` and `intersects` can answer null.

- A shape following an `occurrence<T>` is evaluated against that occurrence, a `T`.

### No conversion

DOMQL converts nothing implicitly: a `number` is not a `boolean`, a `string` is not a `number`, and an `element` is not a `string`. `attribute-of 200`, `intersects(root: 5)` and a `where` whose expression produces a `number` are each validation errors, as is an `element` where a `list` is required.

### Nullability

Nullability is part of a type, and null follows the signature.

- **A null receiver propagates.** If `@panel.parent` is null, `@panel.parent.rect` answers null without invoking `rect`, and its type is `rectangle?`: a path is nullable when any step of it is.
- **A null argument follows the parameter.** A parameter is declared either to propagate null, which is the default and makes the call answer null without running, or to accept null with a meaning of its own, as `intersects` accepts a null `root` to mean the window. Preparation never rejects an evaluated argument for being nullable; it rejects a type that cannot match. A fixed argument that names a declaration, the predicate of `is` and `has`, the name of `get`, the type of `events-of` and the feature of `supports`, is different: it must resolve to a non-null string during preparation, a literal or a bound parameter alike, because a declaration cannot be looked up from null, and `get` could not determine its result type. A nullable binding is accepted when its value supplies a valid name, and an actual null is a validation error for `@panel.get(null)`, `@panel.is(null)` and `@button.events-of(null)`.
- **A written null is an expression that produces null.** `null` as a literal has no special treatment, and the signature and the evaluation rules decide what a call does with it.
- **Null is unavailable too.** An element is a valid receiver of `selection`; one that is no text input answers null, as an unavailable value does. A receiver of the wrong type, a number for `rect`, is a validation error, and a module that returns a value of a type other than the one it declared has broken its contract, which is an evaluation error and never a quiet null.

### Bindings

A binding acquires a type from its value when the value reveals it, and from the type the caller declares with it when it does not.

- An element is an `element`, and a number, a string and a Boolean are `number`, `string` and `boolean`.
- An object is a structured value of the types of its fields, and a list is a `list<T>` when its items share a type `T`.
- `null`, an empty list and a list or an object holding a null do not reveal a type, so a binding of one declares it, `element?` or `list<number>` for instance, and creating the query fails without it.
- A declared type must fit every part of the value: `[1, null]` fits `list<number?>`, and `[1, "two"]` fits no declared type, because DOMQL has no union types and a list holds items of one type. The same check applies to each field of an object, recursively.
- A declared type is written with the type names of this section, `?` for nullable, `list<T>` and `{ field: type, … }` for an object: `element?`, `list<number?>`, `{ id: string, parent: element? }`.
- A tool that checks a query without running it takes the same declared types for the bindings, since vocabulary declarations alone cannot establish the type of `@panel`.

## Requests

A request is one of four kinds, and the member its path ends in decides which:

| Kind | Its path ends in | Its caller |
| --- | --- | --- |
| Query | A value | Reads it once or watches it |
| Subscription | An occurrence source | Listens to it |
| Action | An action | Runs it once, receiving its result |
| Behavior request | A behavior | Establishes it, updates it with new bindings, and releases it |

An action is an operation the browser carries out once, and a behavior is one that runs on in the browser until it is updated or released; both are members an extension declares, with signatures as every member has. A shape can follow an action to shape its result. An action or a behavior ends its request's path, so one inside a query, an argument or another request's shape is a validation error.

Reading or watching a query never performs an action or configures a behavior: a query only reads, and an action or a behavior request acts only when its caller runs or establishes it. A behavior belongs to the caller that established it, and the occurrence sources it offers are listened to as subscriptions of their own.

```
// An action: step the viewport forward, answering whether it moved.
@viewport.scroll(axis: "inline").step(direction: "forward")

// A behavior request: page the viewport with the wheel while Shift is held.
@viewport.scroll(axis: "inline").wheel-paging(modifier: "shift")
```

## Occurrences

A path that ends in an occurrence source is listened to, in two stages. The source hands each occurrence to the evaluator, which evaluates the shape following it at once, in the task the source delivers it in, with that occurrence as its current value. The answer is immutable data, and that answer, never the live event or the shape still to evaluate, is what reaches the caller, by the caller's own delivery. Here the occurrence source is the core vocabulary's native drop event:

```
@zone.events-of "drop" { key: target.closest("[data-drop-target]").attribute-of("data-drop-key") }
```

The shape reads the occurrence's own members, such as its target, and anything else a parameter reaches. Its members are read once per occurrence, never watched, so an unobserved member is allowed in it. An occurrence source documents its members, which of them it captured when the occurrence happened, and when it delivers the occurrence, such as before or after the browser carries out the action it reports; everything else its shape reads is read as the shape is evaluated. An extension's occurrence source can report only what its caller established, so two callers listening on one element each hear their own.

## Evaluation

A query is evaluated synchronously, without yielding, and a member's implementation is synchronous.

Each member declares how it obtains its value.

| Reading | Meaning |
| --- | --- |
| Fresh | Read from the document as the query evaluates, such as an attribute or a box. |
| Maintained | Kept by an observation the member holds, and read as that observation's latest sample, such as the browser's intersection observation. |
| Captured | A sample taken at a moment the member documents, such as the history a member keeps or what an occurrence carried. |

Facts that must describe one measurement are members of one structured value, which is captured once and read by each of its members, as a rectangle's edges are.

A maintained member's observation starts the first time an evaluation reads it, and the member is **pending** until its first sample arrives. A pending member answers null, and the evaluator keeps pending apart from unavailable; the [DOMQL design](domql-design.md) sets out when a request waits for first samples.

Evaluating a query is read-only for every vocabulary. A measurement that needs the document changed first, such as measuring columns at their intrinsic widths under a temporary class, is an action of its own.

A member whose answer depends on what happened before, as well as on the document as it is, is captured: it keeps that history while a watch or a listener holds it, and documents what a read reports without it.

### Elements that leave the document

An element is a value whether or not it is in the document. A member that needs an element's layout answers null while the element has no layout box: while it is detached, and while the browser generates no box for it, as when it or an ancestor is `display: none` or it is `display: contents`. An element with a layout box whose dimensions are zero has actual measurements of zero, and one hidden visually that keeps its box measures as it is. Its attributes and structure still read, and `is "attached"` says whether it is attached, whatever its layout.

## How a member changes

Every member declares how its result changes, for a given receiver and arguments.

| Category | Meaning | In a watch |
| --- | --- | --- |
| Constant | The result never changes, as a literal's, or whether the browser supports a feature. | Allowed; it never invalidates. |
| Observable | The member names change sources that cover every change to its result, such as a resize observation for a size. | Allowed. |
| Partly observable | The member names the sources it can observe and documents the changes they miss, such as a computed style changed by a rule outside the element. | Allowed when the caller accepts partial observation for that watch; a change the sources miss reaches the watch through an explicit refresh or a local invalidation. |
| Unobserved | The member can be read but names no change sources. | A validation error. |

A literal is constant, so a watched shape can carry one: `@viewport { kind: "viewport", width: size.width }`.

## Null

Null answers both "there is no such value", as when `closest` finds no element, and "the value is unavailable", as when an element has no layout to measure. One null for both keeps answers simple, at the cost of telling the two apart; a member whose consumers need the difference offers it separately, as `is "attached"` says whether an element is still attached to the document.

A member of null is null, so a path that meets null answers null from there on, and a mistake is always an error:

| Situation | Result |
| --- | --- |
| `closest` or `first` matches no element | null |
| `all` matches no element | An empty list |
| A supported measurement is unavailable | null, as the member documents |
| Text that does not follow the syntax | A syntax error, with its position |
| A definition that does not follow its structure | A structural error, with its node's location |
| A misspelled member or extension, or a parameter the caller did not supply | A validation error, with its location |
| A receiver, an argument, an expression or a binding of the wrong type, an argument of the wrong kind, or a missing required one | A validation error naming where, the expected type and the type found |
| A module returning a value of a type other than the one it declared | An evaluation error |
| An answer that would contain an element or an occurrence source | A validation error |
| A request used as another kind: reading or watching an occurrence source, listening to a value, running a query, or reading an action or a behavior | A validation error |
| An action or a behavior inside a query, an argument or another request's shape | A validation error |
| Watching a partly observable member without accepting partial observation | A validation error naming each such member and the changes it misses |
| A member failing unexpectedly while it evaluates | An evaluation error |

A query is validated before any evaluation, as the section on validation sets out. An evaluation error fails the whole answer, and the caller receives the error in its place.

## Core vocabulary

The core vocabulary exposes properties and operations over familiar browser concepts. Properties use their declared spelling, and operations use kebab-case. Names are case-sensitive. Measurements use CSS pixels unless stated otherwise. Core members expose state or occurrence sources; actions and behaviors come from extensions.

A property of a structured value, such as a rectangle's `width`, reads data the value holds and is constant for that value. Properties and operations are both members in the grammar; the distinction organizes the vocabulary and adds no syntax.

### Properties

A property exposes a value. It takes no argument, or arguments that only shape the value, as `rect(relativeTo: …)` does. Each property states what it answers, how its result changes, and how it reads, as the section on evaluation defines.

| Available on | Property | Type | Answers | Changes | Reads |
| --- | --- | --- | --- | --- | --- |
| Window | `size` | `size` | The layout viewport's `width` and `height` | Observable | Fresh |
| Window | `devicePixelRatio` | `number` | Device pixels per CSS pixel | Observable | Fresh |
| Element | `rect`, `rect(relativeTo: …)` | `rectangle?`; optional `relativeTo`: `element`, the layout viewport when omitted, and a null `relativeTo` answers null | Its border box's `left`, `top`, `right`, `bottom`, `width` and `height`, relative to the layout viewport, or to `relativeTo`'s border box | Partly observable: size and the scrolling of its scroll containers are observed, transforms and animations are not | Fresh |
| Element | `size` | `size?` | Its border box's `width` and `height` | Observable | Fresh |
| Element | `clientSize` | `size?` | Its padding box's `width` and `height`, without scrollbars | Observable | Fresh |
| Element | `grid.columns` | `list<number>?` | The sizes of its grid's column tracks, an empty list for an element that is no grid | Partly observable, as `computedstyle-of` | Fresh |
| Element | `selection` | `selection?` | Its selection's `start` and `end`, null for an element that is no text input or text area | Partly observable: input and selection events are observed, assignments by script are not | Fresh |
| Element | `children` | `list<element>` | Its child elements, in document order | Observable | Fresh |
| Element | `parent` | `element?` | Its parent element | Observable | Fresh |
| List | `count`, `first`, `last` | `number`, `T?`, `T?` for a `list<T>` | The number of items, the first item and the last item, null where a list has none | As their items | As their items |

### Operations

An operation performs a lookup, a calculation or a selection with the arguments it is given. Each operation states what it answers, how its result changes, how it reads, and which of its arguments are fixed.

| Available on | Operation | Type | Answers | Changes | Reads | Fixed |
| --- | --- | --- | --- | --- | --- | --- |
| Window | `matches-media(query)` | `query`: `string` → `boolean` | Whether the media query matches | Observable | Fresh |  |
| Window | `supports(feature)` | `feature`: `string` → `boolean` | Whether the browser offers a feature from the vocabulary's registered list, such as `"share"`; a name not on the list is a validation error | Constant | Fresh | `feature` |
| Document, element | `is(predicate)`, `has(predicate)` | `predicate`: `string` → `boolean` | Whether the predicate holds, as its contract defines | As its predicate | As its predicate | `predicate` |
| Element | `attribute-of(name)` | `name`: `string` → `string?` | The attribute's value | Observable | Fresh |  |
| Element | `computedstyle-of(property)` | `property`: `string` → `string?` | The property's computed value, custom properties included | Partly observable: its own size and attributes are observed, rules matching from elsewhere are not | Fresh |  |
| Element | `intersects(root, margin)` | optional `root`: `element?`, the window when omitted or null; optional `margin`: `number`, 0 when omitted → `boolean?` | Whether the browser's intersection observation reports it intersecting the root, or the window without a root, grown by the margin, with its ancestors' clipping applied as the browser applies it | Observable | Maintained |  |
| Element | `overlaps(other, margin)` | required `other`: `element`; optional `margin`: `number`, 0 when omitted → `boolean?` | Whether its border box overlaps the other's, grown by the margin, compared as rectangles | Partly observable, as `rect` | Fresh |  |
| Element | `matches(selector)` | `selector`: `string` → `boolean?` | Whether it matches the selector | Partly observable: attributes, structure, focus and popovers' open state are observed; pointer state such as `:hover` and control state such as `:checked` are not | Fresh |  |
| Element | `closest(selector)`, `first(selector)`, `all(selector)` | `selector`: `string` → `element?`, `element?`, `list<element>` | The nearest matching ancestor, itself included; the first matching descendant; the matching descendants, in document order | Partly observable, as `matches` | Fresh |  |
| Any value with members | `get(name)` | `name`: `string` → the type of the property or operation `name` names | The property or operation, or path, `name` names, read as direct access reads it | As its member | As its member | `name` |
| List | `at(index)` | `index`: `number` → `T?` | The item at the index, null where there is none | As its items | As its items |  |
| List | `max(expression)`, `min(expression)`, `sum(expression)` | `expression`: `T` → `number?`; answers `number?`, `number?`, `number` | An aggregate over a number expression, as the section on lists defines | As their items and expressions | As their items |  |
| List | `where(expression)` | `expression`: `T` → `boolean?`; answers `list<T>` | The items for which a Boolean expression holds | As its items and expression | As its items |  |

### Occurrence sources

An occurrence source delivers things that happened. It is listened to, never read or watched, and the shape following it is evaluated against each occurrence.

| Available on | Source | Type | Delivers | Reads | Fixed |
| --- | --- | --- | --- | --- | --- |
| Element, document, window | `events-of(type)` | `type`: `string` → `occurrence<T>` for the event type `type` names | The native events of that type as they reach it, each with the members its declared event type offers, such as a pointer event's `button`, `clientX` and `clientY`; a type the vocabulary declares no event type for is a validation error | Captured at dispatch | `type` |

`is "focused"` asks whether the element itself is focused, `matches(":focus-within")` whether focus is anywhere within it, and an extension can offer richer focus semantics under names of its own; they are separate questions with separate names.

`is "readOnly"` and `is "textEditable"` are separate questions too, and neither is the other's opposite:

| Element | `is "readOnly"` | `is "textEditable"` |
| --- | --- | --- |
| An enabled, writable text input | false | true |
| A read-only text input | true | false |
| A disabled text input without `readonly` | false | false |
| An ordinary static element | false | false |
| An editable content region | false | true |

### Predicates

`is` asks about a state or a classification, and `has` about presence. Each takes a predicate, a name the vocabulary registers with its contract: what it answers, the types it applies to, how it changes and how it reads. A predicate's name is read exactly, as the section on case-sensitive names sets out. A predicate the vocabulary does not register, or one that does not apply to the receiver's type, is a validation error. An extension registers predicates of its own under its namespace, such as `is "scroll.atEnd"`. Each concept has one canonical spelling, so no predicate is an alias of another. `is` and `has` are separate operations with separate predicate names: a predicate is registered for one of them, and naming it through the other is a validation error, so `is "children"` and `has "disabled"` fail.

| Predicate | Of | Answers | Changes | Reads |
| --- | --- | --- | --- | --- |
| `is "attached"` | An element | Whether the element is attached to the document, including through a shadow root | Observable, through the structure of the document and of every shadow root between the element and the document | Fresh |
| `is "disabled"` | An element | Whether the element matches `:disabled`, as the browser decides it: by its own `disabled` attribute, a disabled ancestor `fieldset` other than through that fieldset's first `legend`, or a disabled `optgroup` holding an `option`; whether it carries a `disabled` attribute is `attribute-of "disabled"`, a separate question | Observable: its own and its ancestors' `disabled` attributes and the structure between them | Fresh |
| `is "readOnly"` | An element | Whether native `readonly` applies to the control and is set: a text area, or an input whose type is `text`, `search`, `url`, `tel`, `email`, `password`, `date`, `month`, `week`, `time`, `datetime-local` or `number`; any other element answers false, whatever its attributes | Observable: its `readonly` and `type` attributes | Fresh |
| `is "textEditable"` | An element | Whether the element supports text editing and its current state permits it: a text area, or an input whose type is `text`, `search`, `url`, `tel`, `email`, `password` or `number`, that is neither disabled nor read-only; or an element whose content is editable, by its own or an ancestor's `contenteditable` of `true` or `plaintext-only`, or by the document's design mode. An element that is inert, itself or through an ancestor, is not text editable | Partly observable: everything `is "disabled"` observes, the `readonly` and `type` attributes, the `contenteditable` and `inert` attributes of the element and its ancestors, and the structure between them are observed; the document's design mode is not | Fresh |
| `is "focused"` | An element | Whether it is the focused element | Observable | Fresh |
| `is "visible"` | The document | Whether the document is visible | Observable | Fresh |
| `has "children"` | An element | Whether it has at least one child element | Observable, through its child list | Fresh |
| `has "selection"` | An element | Whether a selection of at least one character lies within it: a non-collapsed selection in a text input or text area, or a non-collapsed document selection within its content; a collapsed caret is no selection | Partly observable: input and selection events are observed, assignments by script are not | Fresh |
| `has "focus"` | The document | Whether focus is anywhere within the document | Observable | Fresh |

### Reading by name

`get` reads a member the current value offers, named by a string, through the same declaration as direct access: `get "rect"` and `rect` resolve the same member, with its one implementation, type, null behavior and observation sources. A dotted name is a member path, each segment validated against the value before it, so `get "grid.columns"` is `grid.columns`; the string names members, never query text.

```
@target {
    get "rect",
    get "clientSize",
    disabled: is "disabled",
    hasChildren: has "children"
}
```

This answers the fields `rect`, `clientSize`, `disabled` and `hasChildren`. The current value decides which names resolve, core and extension members alike:

```
{
    window: @window { get "devicePixelRatio" },
    input: @input { get "selection" }
}
```

- **Names.** Without a name of its own, a `get`, `is` or `has` field takes the name of the last segment of the name it reads, in its declared spelling: `get "rect"` is `rect`, `get "grid.columns"` is `columns`, `is "disabled"` is `disabled` and `has "children"` is `children`. A name that arrives through a bound parameter cannot be known when the query is created, so a field ending in one takes a name of its own. A field naming itself, as `bounds: get "rect"` does, keeps that name, and two fields of one shape with the same name remain an error.
- **Continuing.** A member after a `get` continues from the value it read, so `get "rect".width` is `rect.width` and takes the name `width`; a shape after it shapes that value, so `get "rect" { width, height }` is the field `rect` holding them.
- **Readable members only.** A `get` reads a member that takes no arguments, or none it requires; an action, a behavior or an occurrence source it names is a validation error, so a `get` never acts.
- **Fixed names.** The name is fixed, a literal or a bound parameter settled when the query is prepared, and a field whose path ends in a `get` with a bound name takes a name of its own, since none can be inferred when its definition is created; `get(@name).width` still takes the name `width`.

| Member | Asks | Example |
| --- | --- | --- |
| `get` | For a value | `get "rect"` |
| `is` | About a state or a classification | `is "disabled"` |
| `has` | About presence | `has "children"` |

## Extensions

An extension adds members under one name of its own, a member of a core type whose value carries the extension's members: `@viewport.scroll(axis: "inline")` is a scroll extension's view of an element along an axis, and `canScrollForward` is one of its members. The name is the extension's namespace, so extensions never collide with each other or with the core, whose member names are reserved.

The core vocabulary declares the native event types its callers need, and an extension can declare more. Listening observes an event as it reaches its target and leaves its course to the page.

An extension can define types of its own, occurrence sources, actions and behaviors, and follows the core's contract throughout: every member declares its signature, its argument kinds, its result type and how it changes, and evaluating a query stays read-only and synchronous.

## Definition

A query's **definition** is a JSON document recording its meaning: every query, parsed from text, built fluently or created directly, is one definition, and preparation, validation and evaluation work on the definition alone. It records what the text means, never its punctuation, and comments, commas and the omission of parentheses leave no trace in it.

A document holds the definition's `version` and the `query` node. Each node is an object whose `kind` says what it is:

| Kind | Properties | Records |
| --- | --- | --- |
| `literal` | `value`, a JSON string, number, Boolean or null | A literal |
| `parameter` | `name` | A parameter, the roots `document` and `window` included |
| `member` | `name`, `arguments`, and `target`, the node whose value the member belongs to | A member; without a target, a member of the current value |
| `shape` | `fields`, and `target`, the node the shape follows | A shape; without a target, a shape keeping the current value around it, which at the top level is absent |

An argument is an object holding a `value` node and, for an argument given by name, its `name`; a member's arguments keep the order they were given in. A field is an object holding its `value` node and, where its name was written, its `name`; a shape's fields keep their order. A field without a `name` takes the name its value infers, so the definition keeps the author's naming intent apart from the names the answer takes.

`@panel { size, hasFocus: matches(":focus-within") }` has this definition:

```json
{
  "version": 1,
  "query": {
    "kind": "shape",
    "target": { "kind": "parameter", "name": "panel" },
    "fields": [
      { "value": { "kind": "member", "name": "size", "arguments": [] } },
      {
        "name": "hasFocus",
        "value": {
          "kind": "member",
          "name": "matches",
          "arguments": [{ "value": { "kind": "literal", "value": ":focus-within" } }]
        }
      }
    ]
  }
}
```

A path is a chain of targets: in `@panel.all("li").count`, `count` is a member whose target is `all`, whose target is the parameter `panel`.

A definition names its parameters and never holds their values. An element is bound to its name when the query is created, through whatever mechanism the caller's environment offers, so the same definition serves every binding.

### Validation

A query is validated in two stages, both before any evaluation.

- **Structure,** when the query is created: the definition follows the shape a published JSON Schema describes, and keeps the language's own rules, which need no vocabulary: field names unique within a shape, written and inferred names alike; no shape empty; positional arguments before named ones, and no two named arguments of one call with the same name; no path at the top level, nor a field of a shape there, starting with a member, since there is no current value for it to belong to; and no binding supplied under the name `document` or `window`. Text that does not follow the syntax fails here as a syntax error.
- **Vocabulary,** when the query is prepared: every member and extension exists, every receiver, argument, expression and binding has the type its signature declares and every argument its kind, every fixed argument is a literal or a bound parameter, every member path a `get` names resolves to a readable member, every expression is valid in the context its member declares, the request is used as its kind, the answer holds only data, and a watch's members can be watched.

A failure in either stage names where it is: its position in the text, or its node's location in the definition, as a JSON Pointer.

## What a query runs against

A query is evaluated against a document, with each parameter it names bound to something in that document or to plain data. `@panel` is not found by the query: it stands for the element the caller bound under the name `panel`, which is how a query reaches a particular element without a selector for it. A query that names `@panel` and `@sentinel` is given those two elements, and fails to prepare when either is not bound. The roots `@document` and `@window` need no binding, since they are always the document being queried and its window.

Conceptually, a caller supplies the query's text and the bindings, and gets back an answer shaped like the query:

```text
answer = evaluate(query, bindings: { panel: <the list panel>, sentinel: <the end marker> })
```

The bindings name only what the caller chooses. The complete query below also uses `@document` and `@window`, which are absent from them because they are the document the query runs against and its window, so no caller chooses them and none can bind them.

A caller can take that answer once, keep it current as the document changes, or take one at each occurrence of an event the query listens to; how it asks for each is the [design](domql-design.md)'s to say. A value query is read or watched alike; listening needs an occurrence source, whose projection uses the same expression language.

## A complete query

A list panel asks, in one query, how it is laid out, what it holds, what is in view and what the window around it is doing. The document it is asked of holds a panel of three items, the second selected, and an end marker below them, bound as `panel` and `sentinel`:

```html
<div id="panel" style="display: grid; grid-template-columns: repeat(3, 1fr)">
    <div data-key="a1">…</div>
    <div data-key="a2" aria-selected="true">…</div>
    <div data-key="a3">…</div>
</div>
<div id="sentinel"></div>
```

The query reads it:

```
/* A list panel, its items and the window around it. */
{
    // The panel itself.
    panel: @panel {
        size,
        hasFocus: matches ":focus-within",
        tier: computedstyle-of "--layout-tier",
        columns: grid.columns.count
    },

    // Every item, and the items in the panel's view.
    items: @panel.all("[data-key]") {
        key: attribute-of "data-key",
        height: rect.height,
        selected: matches "[aria-selected=true]"
    },
    inView: @panel.all("[data-key]").where(intersects(root: @panel)).count,
    tallest: @panel.all("[data-key]").max(rect.height),

    // Whether the end of the list is near, and which item is selected.
    nearEnd: @sentinel.intersects(root: @panel, margin: 200),
    current: @panel.first("[aria-selected=true]").attribute-of("data-key"),

    // The window around it.
    window: @window { size, dark: matches-media "(prefers-color-scheme: dark)" },
    visible: @document.is "visible",
    kind: "list"
}
```

Its answer, with three items and the second selected:

```json
{
  "panel": { "size": { "width": 640, "height": 480 }, "hasFocus": false, "tier": "medium", "columns": 3 },
  "items": [
    { "key": "a1", "height": 48, "selected": false },
    { "key": "a2", "height": 64, "selected": true },
    { "key": "a3", "height": 48, "selected": false }
  ],
  "inView": 2,
  "tallest": 64,
  "nearEnd": false,
  "current": "a2",
  "window": { "size": { "width": 1280, "height": 800 }, "dark": true },
  "visible": true,
  "kind": "list"
}
```

With no item selected, `current` is null. With an empty panel, `items` is an empty list, `inView` is 0, and `tallest` and `current` are null. Watching the query requires accepting partial observation, since `matches`, `computedstyle-of`, `grid.columns`, `all` and `first` are partly observable; the watch then follows the items the panel holds, each item's height, attributes and intersection, the panel's size and focus, the sentinel's intersection, the media query and the document's visibility.

## Examples

| Asks | Query |
| --- | --- |
| Whether an element is near the end of a scrolling panel | `@sentinel.intersects(root: @panel, margin: 200)` |
| How many items of a list are in its view | `@list.all("li").where(intersects(root: @list)).count` |
| A layout tier a container query sets | `@header.computedstyle-of "--layout-tier"` |
| How many columns a grid lays out | `@cards.grid.columns.count` |
| A table's tallest row | `@table.all("tbody tr").max(rect.height)` |
| Each column's key and width | `@table.all("[data-column]") { key: attribute-of("data-column"), width: rect.width }` |
| A panel's size, and whether focus is within it | `@panel { size, hasFocus: matches(":focus-within") }` |
| A text field's selection | `@field.selection { start, end }` |
| Whether sharing is available | `@window.supports("share")` |
| The ids of the text-editable elements in a panel | `@panel.all("*").where(is "textEditable") { id: attribute-of "id" }` |
| An element's states and what it holds | `@target { attached: is "attached", disabled: is "disabled", hasChildren: has "children", hasSelection: has "selection" }` |
