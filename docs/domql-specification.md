# DOMQL Specification

DOMQL is a small language for querying the DOM: a query names what its caller wants to know about a document and its elements, and evaluating it gives one answer shaped the way it asked. The same query is read once, watched for changes, or evaluated at each occurrence of something that happened in the document, and the actions and behaviors a caller asks the browser for are requests of their own kinds. The language knows how to name values and shape answers; what can be asked about, an element's size, a computed style, whether it matches a selector, comes from a vocabulary beside it, so adding to what can be asked never changes the language.

This specification defines the language: its syntax, what each request means, the contracts of its vocabulary and the definition every request has. The [DOMQL design](domql-design.md) sets out how requests are built, prepared and carried out.

## Terms

A **query** is a value expression whose evaluation produces an **answer**. A **path** starts from a value and follows **members**; a member belongs to a **type**, such as an element, a list or a rectangle, and can take **arguments**. A **shape** names the **fields** an answer holds, each with a value. A **parameter** is a value the caller supplies under a name, such as an element. A **vocabulary** is a set of types and their members; the **core vocabulary** comes with DOMQL, and an **extension** is a vocabulary registered under a name of its own. An **occurrence source** is a member whose value is a stream of occurrences, things that happened, rather than state. An **action** is an operation the browser carries out once, and a **behavior** one that runs on until it is updated or released; a **request** is a query, a subscription, an action or a behavior request. A query's **definition** is the JSON document recording its meaning, and every request has one.

## Syntax

```
query     = value
value     = start { "." member | shape }
start     = parameter | member | literal | shape
parameter = "@" name
member    = name [ "(" [ argument { "," argument } [ "," ] ] ")" | literal ]
argument  = [ name ":" ] value
shape     = "{" [ field { "," field } [ "," ] ] "}"
field     = [ name ":" ] value
literal   = string | number | "true" | "false" | "null"
```

A name is a letter followed by letters and digits. `true`, `false` and `null` are reserved literal tokens and cannot be used as names, regardless of ASCII case; the restriction applies equally to text queries and to definitions created directly, wherever a name is declared or supplied: a member, a parameter, a field's name, a named argument, and an extension's or a predicate's declaration. A string holding one of them stays an ordinary string, so `attribute "null"` reads the attribute named `null`. A string is double-quoted, with `\"` and `\\` as its escapes. A number is written as in JSON. Commas separate a shape's fields and a member's arguments, and a trailing comma after the last is allowed; whitespace, line breaks included, separates anything else. Outside a string, `//` starts a comment that runs to the end of its line, and `/*` starts one that runs to the next `*/`, across lines; a block comment does not nest, so the first `*/` closes it, and one never closed is a syntax error. Inside a string both are text, so `"https://example.com"` and `"/* */"` read as written.

```
@viewport {
    // The viewport's width, and whether focus is within it.
    width: rect.width,
    hasFocus: matches(":focus-within"),
    columns: all("[data-column]") { key: attribute("data-column"), width: rect.width }
}
```

Arguments are given by position first, then by name; a member's signature names its parameters, and positional arguments bind to them in order.

A member followed by a literal receives that literal as its one argument, so `is "attached"`, `attribute "id"` and `matches ".selected"` are `is("attached")`, `attribute("id")` and `matches(".selected")`, with the same definitions. The shorthand takes exactly one literal, whatever whitespace or line breaks lie between, and a member after it continues from the call's result: `closest ".row".attribute "id"` is `closest(".row").attribute("id")`. Several arguments, a named argument and any argument other than a single literal take parentheses, as `intersects(root: @panel, margin: 200)` and `max(rect.height)` do; the shorthand is decided by the text alone, before any argument's kind is known. The shorthand belongs to the grammar, so every member of every vocabulary takes it alike.

## Names and resolution

A path is evaluated against a **current value**. A bare name is always a member of the current value, and a name starting with `@` is always a parameter, so a reader never has to guess which it is.

- **At the top level** there is no current value, so a query starts with a parameter, a literal or a shape.
- **Inside a shape**, the current value is the value the shape follows: in `@viewport { rect.width }`, `rect` is the viewport's. A shape at the top level, `{ anchor: @anchor.rect, open: @popup.matches(":popover-open") }`, has no current value, so each of its fields starts with a parameter, a literal or a shape.
- **A shape following no value** keeps the current value around it, so it groups fields: in `@panel { layout: { width: size.width, height: size.height } }`, `size` is the panel's. At the top level that value is absent.
- **Parameters** resolve the same way everywhere, inside shapes and arguments alike. A parameter's value is an element, or data: a number, a string, a Boolean, null, a list or an object, as a behavior's configuration is.
- **The roots** are predefined parameters: `@document` is the document and `@page` is the browser window, its layout viewport and what it supports. A supplied parameter cannot take either name.

### Arguments

Every parameter of a member is declared as one of two kinds, and the evaluator treats them differently.

- A **value argument** is evaluated once, where the call is written, against the same current value as the path it appears in. In `@viewport { first(".item").intersects(root: parent) }`, `parent` is the viewport's parent, not the item's. At the top level, where there is no current value, a value argument starts with a parameter, a literal or a shape: `@target.intersects(root: @target.parent)`.
- An **expression argument** is evaluated by the member against a context the member's signature declares, such as each item of a list. In `@table.all("tbody tr").max(rect.height)`, `rect` is each row's.

A value argument can be declared **fixed**, where it selects something validation needs before evaluation, such as the event type whose members `events` offers, the feature `supports` names, the predicate `is` and `has` take or the member `get` reads. A fixed argument is a literal or a bound parameter, whose value is settled when the query is prepared; any other value is a validation error.

Because the kind is part of the signature, the evaluator validates every kind before evaluation and records the dependencies of value and expression arguments while it evaluates.

### Case-insensitive names

Every name DOMQL resolves matches regardless of ASCII case, as an HTML attribute's does: a member, a predicate, a name `get` reads, an extension's namespace and a parameter each resolve whatever their case, and each segment of a member path folds by the same rule. A string is folded only where a member resolves it as a name, as `get` and `is` do. `rect`, `Rect` and `get "RECT"` read one member, and `is "scroll.atEnd"` and `is "scroll.atend"` ask one question, the namespace included.

- **Definitions keep what was written.** A definition records every name as the text or the builder gave it, and whether each field's name was written or is to be inferred.
- **Names never differ by case alone.** Two declarations on one type whose names differ only in case are an error, and so are two bindings of one request, or two fields of one shape.
- **Answers keep the query's spelling.** A field keeps the name it was written with. A field whose name is inferred takes, when the query is prepared, the spelling its member is declared with: `@target { bounds: get "RECT", get "CLIENTSIZE" }` keeps `RECT`, `CLIENTSIZE` and `bounds` in its definition and answers the fields `bounds` and `clientSize`.

A string a member hands to the browser, such as a selector, an attribute's name or value, or an event type, keeps the browser's own rules for its case.

## Values

A value is a number, a string, a Boolean, null, a list, a structured value such as a rectangle, an element, or an occurrence source. A member's signature declares its result type, and every member's result can be null.

An answer is data: numbers, strings, Booleans, null, lists and shaped objects. An element or an occurrence source has no data form, so a query whose answer would contain one is a validation error; a query shapes an element into the facts it needs.

### Shapes

- A field takes the name given before its colon, or, with none, the name of the last member in its path, so `rect.width` is `width` and `all("tr") { … }` is `all`; a `get` takes the name of the member it reads, as the section on reading by name sets out; `is "disabled"` is `is`, so two predicates in one shape each take a name.
- A field whose path follows no member, a parameter, a literal or a shape on its own or followed by a shape, has no name to take and requires one.
- Two fields of one shape whose names differ at most in case are an error when the query is created, and so is an empty shape.
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
@viewport.scroll(axis: "inline").wheelPaging(modifier: "shift")
```

## Occurrences

A path that ends in an occurrence source is listened to, in two stages. The source hands each occurrence to the evaluator, which evaluates the shape following it at once, in the task the source delivers it in, with that occurrence as its current value. The answer is immutable data, and that answer, never the live event or the shape still to evaluate, is what reaches the caller, by the caller's own delivery. Here the occurrence source is the core vocabulary's native drop event:

```
@zone.events("drop") { key: target.closest("[data-drop-target]").attribute("data-drop-key") }
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

An element is a value whether or not it is in the document. While it is detached, a member that needs its layout answers null, and its attributes and structure still read.

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
| An argument of the wrong type or kind, or a missing required one | A validation error |
| An answer that would contain an element or an occurrence source | A validation error |
| A request used as another kind: reading or watching an occurrence source, listening to a value, running a query, or reading an action or a behavior | A validation error |
| An action or a behavior inside a query, an argument or another request's shape | A validation error |
| Watching a partly observable member without accepting partial observation | A validation error naming each such member and the changes it misses |
| A member failing unexpectedly while it evaluates | An evaluation error |

A query is validated before any evaluation, as the section on validation sets out. An evaluation error fails the whole answer, and the caller receives the error in its place.

## Core vocabulary

The core vocabulary uses familiar browser concepts, stated in CSS pixels where it measures, and offers state members and occurrence sources; actions and behaviors come from extensions. A member of a structured value, such as a rectangle's `width`, reads data the value holds, and is constant for that value.

| Available on | Member | Result |
| --- | --- | --- |
| Page | `size` | The layout viewport's size |
| Page | `devicePixelRatio` | A number |
| Page | `matchesMedia(query)` | A Boolean |
| Page | `supports(feature)` | A Boolean |
| Document | `is(predicate)`, `has(predicate)` | A Boolean, as the predicate defines |
| Element | `rect`, `rect(relativeTo: …)` | A rectangle in the requested coordinate space |
| Element | `size` | Its border box's size |
| Element | `clientSize` | Its client area's size |
| Element | `attribute(name)` | An attribute's value |
| Element | `computedStyle(property)` | A property's computed value |
| Element | `grid.columns` | A list of column-track sizes |
| Text input or text area | `selection` | Its selection's start and end |
| Element | `is(predicate)`, `has(predicate)` | A Boolean, as the predicate defines |
| Element | `intersects(root: …, margin: …)` | An observed intersection |
| Element | `overlaps(other: …, margin: …)` | A rectangle overlap |
| Element | `matches(selector)` | A Boolean |
| Element | `closest(selector)` | The matching element, itself included |
| Element | `first(selector)` | The first matching descendant |
| Element | `all(selector)` | The matching descendants |
| Element | `children` | Its child elements |
| Element | `parent` | Its parent element |
| Element, document, page | `events(type)` | An occurrence source |
| Any value with members | `get(name)` | The value of the member, or member path, the name names |
| List | `count`, `first`, `last`, `at(index)` | A count or an item |
| List | `max(expression)`, `min(expression)`, `sum(expression)` | An aggregate value |
| List | `where(expression)` | A filtered list |

`is "focused"` asks whether the element itself is focused, `matches(":focus-within")` whether focus is anywhere within it, and an extension can offer richer focus semantics under names of its own; they are separate questions with separate names.

`is "readOnly"` and `is "texteditable"` are separate questions too, and neither is the other's opposite:

| Element | `is "readOnly"` | `is "texteditable"` |
| --- | --- | --- |
| An enabled, writable text input | false | true |
| A read-only text input | true | false |
| A disabled text input without `readonly` | false | false |
| An ordinary static element | false | false |
| An editable content region | false | true |

### Contracts

Each member's contract states what it answers, how its result changes, how it reads, as the section on evaluation defines, and which of its arguments are fixed.

| Member | Answers | Changes | Reads | Fixed |
| --- | --- | --- | --- | --- |
| Page `size` | The layout viewport's `width` and `height` | Observable | Fresh | |
| `devicePixelRatio` | Device pixels per CSS pixel | Observable | Fresh | |
| `matchesMedia(query)` | Whether the media query matches | Observable | Fresh | |
| `supports(feature)` | Whether the browser offers a feature from the vocabulary's registered list, such as `"share"`; a name not on the list is a validation error | Constant | Fresh | `feature` |
| `rect` | Its border box's `left`, `top`, `right`, `bottom`, `width` and `height`, relative to the layout viewport, or to `relativeTo`'s border box | Partly observable: size and the scrolling of its scroll containers are observed, transforms and animations are not | Fresh | |
| Element `size` | Its border box's `width` and `height` | Observable | Fresh | |
| `clientSize` | Its padding box's `width` and `height`, without scrollbars | Observable | Fresh | |
| `attribute(name)` | The attribute's value | Observable | Fresh | |
| `computedStyle(property)` | The property's computed value, custom properties included | Partly observable: its own size and attributes are observed, rules matching from elsewhere are not | Fresh | |
| `grid.columns` | The sizes of its grid's column tracks, an empty list for an element that is no grid | Partly observable, as `computedStyle` | Fresh | |
| `selection` | Its selection's `start` and `end` | Partly observable: input and selection events are observed, assignments by script are not | Fresh | |
| `intersects(root, margin)` | Whether the browser's intersection observation reports it intersecting the root, or the page without a root, grown by the margin, with its ancestors' clipping applied as the browser applies it | Observable | Maintained | |
| `overlaps(other, margin)` | Whether its border box overlaps the other's, grown by the margin, compared as rectangles | Partly observable, as `rect` | Fresh | |
| `matches(selector)` | Whether it matches the selector | Partly observable: attributes, structure, focus and popovers' open state are observed; pointer state such as `:hover` and control state such as `:checked` are not | Fresh | |
| `closest(selector)`, `first(selector)`, `all(selector)` | The nearest matching ancestor, itself included; the first matching descendant; the matching descendants, in document order | Partly observable, as `matches` | Fresh | |
| `is(predicate)`, `has(predicate)` | Whether the predicate holds, as its contract defines | As its predicate | As its predicate | `predicate` |
| `children`, `parent` | Its child elements, in document order; its parent element | Observable | Fresh | |
| `events(type)` | The native events of that type as they reach it, each with the members its declared event type offers, such as a pointer event's `button`, `clientX` and `clientY`; a type the vocabulary declares no event type for is a validation error | Listened to, never watched | Captured at dispatch | `type` |
| `get(name)` | The member, or member path, `name` names, read as direct access reads it | As its member | As its member | `name` |
| List members | As the section on lists defines | As their items and expressions | As their items | |

### Predicates

`is` asks about a state or a classification, and `has` about presence. Each takes a predicate, a name the vocabulary registers with its contract: what it answers, the types it applies to, how it changes and how it reads. A predicate's name matches regardless of case, as the section on case-insensitive names sets out. A predicate the vocabulary does not register, or one that does not apply to the receiver's type, is a validation error. An extension registers predicates of its own under its namespace, such as `is "scroll.atEnd"`. Each concept has one canonical spelling, so no predicate is an alias of another.

| Predicate | Of | Answers | Changes | Reads |
| --- | --- | --- | --- | --- |
| `is "attached"` | An element | Whether the element is attached to the document, including through a shadow root | Observable, through the structure of the document and of every shadow root between the element and the document | Fresh |
| `is "disabled"` | An element | Whether the element matches `:disabled`, as the browser decides it: by its own `disabled` attribute, a disabled ancestor `fieldset` other than through that fieldset's first `legend`, or a disabled `optgroup` holding an `option`; whether it carries a `disabled` attribute is `attribute "disabled"`, a separate question | Observable: its own and its ancestors' `disabled` attributes and the structure between them | Fresh |
| `is "readOnly"` | An element | Whether native `readonly` applies to the control and is set: a text area, or an input of a type `readonly` applies to, such as `text`, `email`, `number` or `date`; any other element answers false, whatever its attributes | Observable: its `readonly` and `type` attributes | Fresh |
| `is "texteditable"` | An element | Whether the element supports text editing and its current state permits it: a text area, or an input of a type that takes typed text, such as `text`, `search`, `email` or `number`, that is neither disabled nor read-only; or an element whose content is editable, by its own or an ancestor's `contenteditable` or the document's design mode | Partly observable: its `type`, `disabled` and `readonly` attributes, the `contenteditable` attributes of it and its ancestors, and the structure between them are observed; the document's design mode is not | Fresh |
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
    page: @page { get "devicePixelRatio" },
    input: @input { get "selection" }
}
```

- **Names.** Without a name of its own, a `get` field takes the name of the last member its path names: `get "rect"` is `rect` and `get "grid.columns"` is `columns`. A field naming itself, as `bounds: get "rect"` does, keeps that name, and two fields of one shape whose names differ at most in case remain an error.
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

A query's **definition** is a JSON document recording its meaning: every query, parsed from text, built fluently or created directly, is one definition, and preparation, validation and evaluation work on the definition alone. It records what the text means, never its punctuation, and comments, commas, the one-literal shorthand and inferred names leave no trace in it.

A document holds the definition's `version` and the `query` node. Each node is an object whose `kind` says what it is:

| Kind | Properties | Records |
| --- | --- | --- |
| `literal` | `value`, a JSON string, number, Boolean or null | A literal |
| `parameter` | `name` | A parameter, the roots `document` and `page` included |
| `member` | `name`, `arguments`, and `target`, the node whose value the member belongs to | A member; without a target, a member of the current value |
| `shape` | `fields`, and `target`, the node the shape follows | A shape; without a target, a shape keeping the current value around it, which at the top level is absent |

An argument is an object holding a `value` node and, for an argument given by name, its `name`; a member's arguments keep the order they were given in. A field is an object holding its `value` node and, where its name was written, its `name`; a shape's fields keep their order. A field without a `name` takes the name its value infers, which preparation spells as the member is declared, so the definition keeps the author's spelling and naming intent apart from the answer's names.

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

- **Structure,** when the query is created: the definition follows the shape a published JSON Schema describes, and keeps the language's own rules, which need no vocabulary: field names unique within a shape regardless of case, written and inferred names alike; no shape empty; positional arguments before named ones; no path at the top level, nor a field of a shape there, starting with a member, since there is no current value for it to belong to; and no binding supplied under the name `document` or `page` in any case. An inferred name is compared in the spelling the text gives it, since its declared spelling differs from that at most in case. Text that does not follow the syntax fails here as a syntax error.
- **Vocabulary,** when the query is prepared: every member and extension exists, every argument has the type and kind its signature declares, every fixed argument is a literal or a bound parameter, every member path a `get` names resolves to a readable member, every expression is valid in the context its member declares, the request is used as its kind, the answer holds only data, and a watch's members can be watched.

A failure in either stage names where it is: its position in the text, or its node's location in the definition, as a JSON Pointer.

## A complete query

A list panel asks, in one query, how it is laid out, what it holds, what is in view and what the page around it is doing:

```
/* A list panel, its items and the page around it. */
{
    // The panel itself.
    panel: @panel {
        size,
        hasFocus: matches(":focus-within"),
        tier: computedStyle("--layout-tier"),
        columns: grid.columns.count
    },

    // Every item, and the items in the panel's view.
    items: @panel.all("[data-key]") {
        key: attribute("data-key"),
        height: rect.height,
        selected: matches("[aria-selected=true]")
    },
    inView: @panel.all("[data-key]").where(intersects(root: @panel)).count,
    tallest: @panel.all("[data-key]").max(rect.height),

    // Whether the end of the list is near, and which item is selected.
    nearEnd: @sentinel.intersects(root: @panel, margin: 200),
    current: @panel.first("[aria-selected=true]").attribute("data-key"),

    // The page around it.
    page: @page { size, dark: matchesMedia("(prefers-color-scheme: dark)") },
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
  "page": { "size": { "width": 1280, "height": 800 }, "dark": true },
  "visible": true,
  "kind": "list"
}
```

With no item selected, `current` is null. With an empty panel, `items` is an empty list, `inView` is 0, and `tallest` and `current` are null. Watching the query requires accepting partial observation, since `matches`, `computedStyle`, `grid.columns`, `all` and `first` are partly observable; the watch then follows the items the panel holds, each item's height, attributes and intersection, the panel's size and focus, the sentinel's intersection, the media query and the document's visibility.

## Examples

| Asks | Query |
| --- | --- |
| Whether an element is near the end of a scrolling panel | `@sentinel.intersects(root: @panel, margin: 200)` |
| How many items of a list are in its view | `@list.all("li").where(intersects(root: @list)).count` |
| A layout tier a container query sets | `@header.computedStyle("--layout-tier")` |
| How many columns a grid lays out | `@cards.grid.columns.count` |
| A table's tallest row | `@table.all("tbody tr").max(rect.height)` |
| Each column's key and width | `@table.all("[data-column]") { key: attribute("data-column"), width: rect.width }` |
| A panel's size, and whether focus is within it | `@panel { size, hasFocus: matches(":focus-within") }` |
| A text field's selection | `@field.selection { start, end }` |
| Whether sharing is available | `@page.supports("share")` |
| The ids of the text-editable elements in a panel | `@panel.all("*").where(is "texteditable") { id: attribute "id" }` |
| An element's states and what it holds | `@target { attached: is "attached", disabled: is "disabled", hasChildren: has "children", hasSelection: has "selection" }` |
