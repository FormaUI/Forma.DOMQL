# DOMQL Implementation Plan

This plan records the steps that take DOMQL from what is built to what the [specification](domql-specification.md) and the [design](domql-design.md) describe, the decisions that shape them, the state of each step, and where the work departs from the design. The design is authoritative; this plan changes with the work and is retired when every step is done.

## Built

Each item is what exists and what checks it.

- **The language.** Parsing text and creating queries from their definition, with the position of every mistake. Checked by the tests of parsing and of the definition.
- **The vocabulary.** The built-in vocabulary declared as module data, and modules that extend it. Checked by the tests of modules, the registry and the vocabulary.
- **Resolution.** Resolving a definition against the vocabulary and typing its result, without a browser; the resolution is kept for its query. Checked by the resolver tests and the tests of `Domql.resolve`.
- **Reading.** `read` reads every built-in member except `intersects`, which is maintained, and fails it with an evaluation error that says so; a subscription, which ends in an occurrence source such as `eventsOf`, is listened to and never read. `readAsync` waits for the first sample of a maintained member, evaluates again as samples arrive and as what the query depends on changes, and lets go of its observations when it answers, fails or is canceled. Each evaluation records its dependencies. A read answers detached, immutable data. Checked by the evaluator tests, in a simulated DOM, and by the browser tests, in Chromium, for geometry, for state the browser decides and for the reads that wait.
- **Observations.** The built-in vocabulary names the observations that cover its members' changes, as types a module declares, and observations are started, shared and ended through sessions. There is no public API for them yet. Checked by the tests of declarations, of the sessions and of the browser observers, and in Chromium by a test of each type of observation reporting a change.
- **Watching.** `Domql.watch` evaluates a query, reports its snapshot, and evaluates again when what the result depends on changes, at the next animation frame or in the task that reported the change, reporting a snapshot that differs and sharing the branches of the last that did not. A watch follows the document, keeps its dependencies through a failed evaluation, recovers, and is refreshed and disposed through its handle. Checked by the tests of watches and of comparing snapshots, in a simulated DOM, and in Chromium by a watch of a size and of a maintained member.
- **Subscribing.** `Domql.subscribe` answers an event listener, which starts a subscription's occurrence source in the call and, at each occurrence, captures the fields its event type declares and evaluates the shape that follows the source, inside the source's delivery, handing the immutable result to its callback. A maintained member answers its latest sample, or null while it is pending, and is never waited for; the event listener keeps the sessions its last successful projection read, keeps them through a projection that fails, and lets go of everything when disposed. Checked by the tests of projection and of event listeners, in a simulated DOM, and in Chromium by an event listener of clicks and of a maintained member across occurrences.
- **Change sets.** A watch that delivers change sets sends a baseline and then JSON Patch change sets, each acknowledged before the next is computed against the state it established, and recovers with a baseline of a new generation that nothing earlier can affect. Lists projected from elements change by element, through identities kept beside the result. A current snapshot applies each update atomically and gives a stale one no effect. Checked by the tests of computing and of applying change sets, each against expected patches and results and together, of the dispatcher and the current snapshot, and of watches delivering to a receiver.
- **The package.** The bundle, with its TypeScript declarations checked against `Domql` and against a TypeScript caller; the READMEs' examples run as tests.

What is not built: live state, actions and behaviors, the fluent builder, the C# half and editor tooling.

## Decisions

Each decision is open until its state says otherwise, and a step that needs it does not start before.

### D1. How a declaration names the observations that cover its changes

A declaration states how a member changes as a category. A watch needs the observations themselves.

- **Recommended: observations are of named types.** A declaration lists the observations that cover its changes, each of a named type with its target and the arguments that matter to it, such as `{ type: 'resize', of: 'receiver' }`. The built-in vocabulary defines the types it observes with: resize, attributes and structure, intersection, media query, focus and selection events, and document visibility. A module can contribute types of its own, each with the function that starts the observation and releases it. Declarations stay data, so a tool reads them without running anything, and a custom observation stays possible.
- **Two contracts, one lifecycle.** An *invalidation* observation says that the result may have changed and the query should be evaluated again; it carries no value. A *maintained* observation provides a sampled value that a member reads, and is pending until its first sample. Both are started, shared and released the same way; their contracts differ and a type is one or the other.
- **Identity.** Equivalent observation requests share an underlying observation where their type permits it. A request's identity is its type, its target, the arguments that change what is observed, such as an intersection's root and margin or the attributes an observation filters on, and the DOM environment it belongs to. A type states which of its arguments belong to the identity and whether sharing is permitted at all.
- **Alternative: a function per member.** A member supplies a function that subscribes and returns its release. It is the most flexible and leaves nothing for a tool to read.

State: **done.** Built in its recommended form by step 1.

### D2. How a read waits

The design has a read wait for the first sample of every maintained member it reads, and a wait cannot be synchronous.

- **Chosen: `read` stays synchronous and `readAsync` waits.** `Domql.read(query, options)` answers the data itself and fails with an evaluation error for a query that reads a maintained member, naming the member. `Domql.readAsync(query, { signal, window })` answers a promise, waits for the samples of every maintained member the query reads, can be canceled, and also reads a query with no maintained member, so a caller can use it for every query.
- **The name follows the exception.** Almost every operation DOMQL has answers directly, so the plain name is the synchronous one, and every operation that answers a promise takes the suffix `Async`, as `readAsync`, `refreshAsync` and `runAsync` do.
- **Guarantees of `readAsync`.**
  - Cancellation and failure dispose every session the read opened.
  - Waiting evaluates again as samples arrive and as dependencies change. It never answers while a maintained member the result reads is still pending, including one that a later evaluation introduced.
  - The result uses fresh reads and the samples available when the last evaluation ran. It does not promise that every measurement was taken at the same instant.
- **Alternative:** `read` answers a promise and `readSync` answers the data, as Node names `readFile` and `readFileSync`. It gives the short name to the form that reads every query, and puts the suffix on the greater part of the operations.

State: **done.** Built in its chosen form by step 2.

### D3. The public API of a watch and an event listener

- **Chosen:** `Domql.watch(query, configuration)` answers a handle, and `Domql.subscribe(query, configuration)` answers an event listener, the handle for a subscription. Each takes a query or its text, as `read` and `readAsync` do: `(text, parameters, configuration)` parses the text through the same cache as `parse`, and `(query, configuration)` reuses a query. The configuration holds the callbacks, which a watch and an event listener require, and chooses the schedule, the update strategy and whether the watch accepts partial observation. A caller chooses where a snapshot is delivered; DOMQL never decides it.
- **Status.** A watch's handle has a `status`: `pending`, `ready`, `failed` or `disposed`, and an event listener's `ready` or `disposed`, as step 5 records. The snapshot, which can be null, is read beside the status, never in place of it.
  - **A watch** is `pending` until its first snapshot is available, including the samples of the maintained members it reads, and `ready` from then on. After an evaluation fails it is `failed`, keeps running, and keeps its last successful snapshot, if it has one. It returns to `ready` with its next successful evaluation, even when that snapshot equals the last one; the design's rule that the snapshot is reported after a failure holds.
  - **An event listener** is `pending` until its occurrence subscription is established and `ready` once it is, without waiting for an event. An event whose evaluation fails is reported to the error callback and leaves the event listener `ready`.
- **The first snapshot.** It is delivered through the same callback as every later one, as the baseline, so a caller has one path for all of them.
- **Callbacks.** A callback receives each delivery in delivery order, and DOMQL does not wait for the promise a callback returns. The continuations of asynchronous callbacks can overlap; a caller that needs them one at a time arranges that at its own delivery boundary.
  - A callback that throws, or whose promise rejects, leaves the state it was handed accepted, as the design says, and the failure is reported to the error callback; it does not stop the watch.
  - A failure of the error callback itself, by throwing or rejecting, never calls it again and interrupts no other subscription. It goes to the diagnostic reporting boundary, as a failure of an observation's callback does.
- **`refreshAsync()`.** It answers a promise that settles once the evaluation it caused has completed and the delivery it produced, if any, has been handed to the callback; it does not wait for a promise the callback returns, so a callback can await a refresh without a cycle.
  - It rejects with the failure of its evaluation, which is also reported to the error callback.
  - It resolves without delivering when disposal cancels it.
  - It rejects when called after disposal.
- **`dispose()`.** It cancels scheduled evaluation, disposes every session, sets the status to `disposed`, and prevents any new callback invocation; a callback already running may finish. Disposing again does nothing.
- **Update strategies.** A snapshot is immutable and never changes once delivered. A change set is relative to the state it was computed against. Live state is one object with a stable identity, updated in place, so it is chosen explicitly and is never a snapshot. Each update to live state is fully applied before its callback begins; a consumer that is asynchronous and needs to retain one version chooses snapshots, since live state can change while it waits.
- **An event listener.** It delivers the result of each event's projection through its callback, `onEvent`, with the same callback, failure and disposal rules.

State: **accepted.** Built by steps 3 to 5, with the departures each records, except live state, which step 7 builds.

### D4. What DOMQL owns and what a host owns

State: **accepted.**

- **DOMQL owns** the semantics every host shares: evaluation, dependency recording, observation sessions, snapshots, baselines, revisions, change-set computation and the atomic application of a change set. It also owns the ordering rules that stop a stale update from being accepted.
- **A host owns** transport, acknowledgments, reconnection, who owns a watch, and asking for a replacement baseline when its receiver cannot be trusted.
- **A host never keeps a second watch or patch implementation.** A baseline is how a host recovers; DOMQL does not know what a connection is.

### D5. The API of actions and behaviors

```js
const result = await Domql.runAsync(query, options);
const behavior = Domql.establish(query, options);

behavior.update(bindings);
behavior.dispose();
```

- **Recommended: two entry points, each taking options.** `Domql.runAsync` runs an action once and answers a promise of its result; `Domql.establish` answers the handle of a behavior, which belongs to the caller that established it, and releasing it leaves its module registered. Neither needs a callback, so each takes options, every one of which has a default: `runAsync` takes `window` and `signal`, and `establish` takes `window`. A query never runs an action or establishes a behavior.
- **The request's kind.** Each refuses a request of another kind with a validation error after resolution and before anything is evaluated or started, as reading, watching and subscribing do: `runAsync` takes an action request, `establish` a behavior request, and the other calls refuse both.
- **Text.** Each takes a request or its text, as the other entry points do: `(text, parameters?, options?)` parses the text through the same cache as `parse`, and `(query, options?)` reuses a request.
- **Running an action.**
  - The receiver and the arguments are evaluated first, synchronously, as a read evaluates them; a failure there rejects the promise and runs nothing.
  - The action's function receives the receiver, the arguments, the environment and the signal, and may answer its result or a promise of it, which is why the call waits. Its result must be of the type the action declares, and data alone; a result of another type rejects the promise with an evaluation error naming the action. A shape that follows the action is evaluated against the result once it arrives, and the promise answers detached, immutable data.
  - A failure of the action, whatever it throws, rejects the promise with an evaluation error naming the action, whose cause is what was thrown. Nothing goes to the error reporting while the caller holds the promise.
  - Cancellation: a signal already aborted rejects with its reason and runs nothing. A signal that aborts while the action runs rejects the promise with its reason at once, as a waiting read does, and the action learns of it through the signal it was given. What the action does after that is its own: its result is discarded, and a failure it reports afterwards goes to the window's error reporting, since no caller waits for it.
  - Partial failure: an action can change the document before it fails or is canceled. DOMQL never rolls back what it did; the rejection says the action failed, and what it changed stays changed. An action that can be undone offers that as an action of its own.
- **Establishing a behavior.** `establish` is synchronous: the behavior's function receives the receiver, the arguments and the environment, starts the behavior before it returns, and answers an object with `update` and `dispose`. A failure to start, or an answer without both, throws an evaluation error naming the behavior, whose cause is what was thrown, and leaves nothing running. A behavior that needs to wait before it is in effect is outside this decision; it would be established by an `establishAsync` of its own, decided when one is needed.
- **The handle.** It has a `status`, `ready` from the call on and `disposed` once ended, with `update(bindings)` and `dispose()`. A failure inside the running behavior, after it started, goes to the window's error reporting; the behavior's function receives the reporter for it.
- **Updating bindings.** `update(bindings)` replaces the bindings whole, as `create` binds a definition, so a caller states every parameter and nothing is left over from before. It is synchronous and validates first: the bindings are checked, the request is resolved again against them, and the receiver and arguments are evaluated. Any failure throws, a validation or an evaluation error, and leaves the behavior running as it was, with its earlier bindings. A resolution that would select a different member, as a fixed argument bound to another value can, is refused with a validation error, since that is another behavior to establish. Only once all of that succeeds does the behavior's `update` receive the new receiver and arguments; a failure there throws an evaluation error naming the behavior, and the behavior keeps the bindings it last accepted, since its module promises that an update that fails changed nothing. Updating a disposed behavior throws.
- **Disposal.** `dispose()` ends the behavior once and is idempotent. It calls the behavior's `dispose`, reports a failure of it to the window's error reporting, and marks the handle `disposed` whatever happened, so nothing is left to call again. Since establishing and updating are synchronous, no work is pending when it is disposed.
- **The module contract.** An action's function is `(receiver, args, environment, { signal })` and answers a result or a promise of it; a behavior's function is `(receiver, args, environment, { reportError })` and answers `{ update(receiver, args), dispose() }`.
- **Left for later:** the occurrence sources a behavior offers, which the specification subscribes to as subscriptions of their own, are a decision of their own once a behavior that offers one exists.

State: open. Needed by step 6.

### D6. Predicate tests and parenthesized arguments

`@document.is "visible"` read as a member glued to its receiver with its argument set apart, and it made `is` and `has` members although they have no function, a fixed argument that selects a predicate and a contract that comes from the predicate.

- **Chosen: `is` and `has` are operators of the language.** A test applies a verb to the value before it, or to the current value inside a shape or an expression, and reads predicates the vocabulary registers: `@document is "visible"`, `@panel { attached: is "attached" }`. `and` and `or` combine names under the one verb, `and` binding tighter and parentheses grouping; the subject is evaluated once, and a test stops at the first operand that decides it while every branch is resolved and validated beforehand. Names are strings or bound parameters, a test of null is null, a test of one literal name infers its field's name, and a definition records a test as a `predicate` node whose `test` holds the names and their `and` and `or`.
- **Arguments after a dot are parenthesized.** A member that starts a path may take bare literals and parameters, and such a phrase ends its path; after a dot, arguments take parentheses, and `@sentinel.intersects @panel 200` is a syntax error saying so.
- **Alternative:** keep `is` and `has` as members, writing `@document.is("visible")` by convention. It leaves two members unlike every other and gives composition no place.
- **Left for later:** negation, and a test that mixes `is` and `has`, each a decision of its own.

The specification's revision 1.0.6 defines it. State: **done.**

### D7. One camelCase name for every member

Operations were kebab-case in a query, `attribute-of`, and camelCase in the fluent builder, `attributeOf`, so each declaration carried a builder name beside its DOMQL name.

- **Chosen: every member is named in camelCase,** properties and operations alike, the same in a text, a definition and the builder, with parentheses or without: `@panel.attributeOf("data-key")`, `@window.matchesMedia("(prefers-color-scheme: dark)")`, `{ key: attributeOf "data-key" }`. A declaration carries no builder name, since its DOMQL name is the builder's spelling.
- **A name holds no hyphen.** A name is a letter followed by letters and digits, so every name a module declares is a JavaScript identifier and kebab-case cannot return through a module; a hyphen in a name is a syntax error saying so. The built-in module is named `builtIn`, and observation types are named the same way, as `pixelRatio` is.
- **Alternative:** camelCase for the built-in members only, keeping hyphens in the grammar and the builder name in declarations. It leaves two spellings a module could choose between, and a conversion the builder would have to make.

The specification's revision 1.0.7 defines it. State: **done.**

## Steps

A step is done when its tests pass in the gate, its documents say what it built, and its state here says so.

### 1. Observation types and observations

Name the observations a declaration carries (D1), and build the layer that starts, shares and ends observations through sessions: equivalent requests share one observation, started on first use and stopped when its last session is disposed.

- **Needs:** D1.
- **Done when:** every member of the built-in vocabulary names its observations, each an invalidation observation or a maintained one; a session starts an observation once for equivalent requests and ends it when the last is disposed; requests that differ in an argument that belongs to the identity do not share; each type of observation reports a change in a real browser.
- **State:** done. The pixel ratio is checked with a window whose ratio the test controls, because a test cannot change the ratio of the browser it runs in.

### 2. Dependencies and maintained members

Record what an evaluation read, member by member and item by item, with each member's observations. Read maintained members from their observation's latest sample, pending until the first arrives, and build the waiting `readAsync`.

- **Needs:** step 1, D2.
- **Done when:** a query's dependencies are the ones the design lists, including those of expression arguments, of a path that met null and of a detached element; `intersects` reads in a real browser; `readAsync` waits for the first sample, evaluates again for a member a later evaluation introduces, and disposes its sessions on cancellation and on failure.
- **State:** done. Where it departs from the design: a member that answered null for a detached element records the element's attachment in the evaluator, once for every member, instead of each declaration naming it; an evaluation that fails while a maintained member is pending reports nothing and waits, since the failure may come from the null the pending member answered; a read holds the observations of a maintained member always, and the others only while it waits, since a result that is complete needs nothing more observed, where a watch holds them all; and the reads in one window share one set of observations.

### 3. Watches

Evaluate, report and evaluate again when an observation fires, reporting only a snapshot that differs: the schedule, the subscriptions that follow the dependencies, the comparison with a member's tolerance, a failed evaluation, an element that leaves the document and returns, and acceptance of partial observation. Snapshots are the first delivery.

- **Needs:** steps 1 and 2, D3.
- **Done when:** a watch follows the document as the design describes; its status, first delivery, `refreshAsync`, failing callback and disposal behave as D3 defines; it delivers snapshots that share their unchanged parts, and disposes every session when it ends.
- **State:** done. Where it departs from the design: a member declares its tolerance as `tolerance`, and no built-in member declares one yet, so their numbers compare exactly; the first evaluation follows the call that creates the watch, so no callback runs before the caller has the handle; and `updateStrategy` takes `snapshot` alone until step 4 builds change sets.

### 4. Change sets and recovery

Deliver a baseline and then change sets as JSON Patch limited to `replace`, `add`, `remove` and `move`, with coalescing and the rules of ordering that recovery relies on: DOMQL numbers its baselines and revisions, accepts a change set only against the state it was computed against, applies it atomically, and gives a stale update no effect.

- **Needs:** step 3, D4.
- **Done when:** applying each change set to the state it was computed against gives the next result; the design's rules of recovery hold under failed, late and out-of-order deliveries; a host that asks for a replacement baseline gets one that nothing earlier can affect.
- **List projections** keep an internal identity for each element they project, so a change set expresses insertions, removals and moves without a result holding an element reference. Tests include projected values that repeat, and a list that is reordered and updated in one change.
- **State:** done. Where it departs from the design or adds to it: the acknowledgment contract is the watch's `acknowledge(update)` and `recover()`, with `updateStrategy: 'changeSet'` choosing change sets, beside D3's handle, and an update names its generation and the revisions it goes from and to; the receiving side is `Domql.createSnapshot()`, a current snapshot whose `apply(update)` answers `accepted`, `stale` or `failed` and whose `value` is the snapshot last accepted; and a recovery from a failed evaluation whose result did not change delivers an empty change set, as D3's rule that the result is reported after a failure asks. Live state, the third delivery kind, is not built.

### 5. Occurrence sources

Deliver what an occurrence source reports: `eventsOf` captures what the event carries at dispatch, the shape after it is evaluated for each occurrence, and the sessions its shapes open are held across occurrences.

- **Needs:** steps 1 and 2, D3.
- **Done when:** a subscription delivers one immutable result for each occurrence and releases everything when it ends. Its tests include:
  - the first occurrence answering null for a maintained member whose sample is still pending, and a later occurrence reading the sample that arrived;
  - an evaluation that depends on different members from the one before it keeping what it reads and releasing the rest;
  - a failed projection delivering nothing, keeping the sessions it held before and disposing those the failed attempt opened.
- **State:** done. Where it departs from D3 or adds to the design:
  - An event listener starts its source in the call that creates it, so an occurrence dispatched right after the call is heard, and a source that cannot start fails the call with an evaluation error, whose cause is whatever the source threw. Its status is `ready` from the call on and `disposed` once ended, so it is never `pending`.
  - A source may deliver while it starts. Those occurrences are captured and projected at once, and their callbacks run once the caller has the event listener, before those of any later occurrence; where the start fails, their callbacks never run and the sessions they opened are let go of.
  - Its callback is `onEvent`, beside `onError` and `window`; the callback and failure rules are the watch's, and both carry them out alike.
  - The source's receiver and arguments are evaluated once, as listening starts; an event listener does not follow a receiver that changes, and listens to nothing where the receiver or an argument is null.
  - An occurrence is captured as the fields its event type declares, inside the source's delivery: a field the occurrence carries no value of its type for is null where the type is nullable and fails the capture where it is not, which is reported as a projection's failure is. So `domEvent`'s `target` is nullable, for a scroll or a resize that targets the document or the window, and so is `pointerEvent`'s `pointerType`, for a browser that dispatches a click as a mouse event.
  - A source's function takes the receiver, the arguments, the environment and the function it delivers each occurrence to, and answers an object whose `stop` ends the listening; the built-in `eventsOf` listens passively.
  - Disposing an evaluation disposes every session even where one fails to be. A watch, an event listener and a waiting read each attempt every cleanup, report a failure of one to the window's error reporting, and never let it replace their result, their error or their cancellation.

### 6. Actions and behaviors

Run an action once and receive its result, and establish, update and release a behavior whose instance belongs to its caller. Registering a module makes its capability understood; establishing a behavior creates an instance.

- **Needs:** D5; independent of steps 1 to 5.
- **Done when:** an extension's action and behavior run through their request kinds, a query never performs either, and releasing an instance leaves its module registered.
- **State:** not started.

### 7. Live state

Deliver a watch's result as live state: one object with a stable identity that the watch updates in place, the third update strategy D3 accepts. It is chosen explicitly and is never a snapshot, and each update is fully applied before its callback begins.

- **Needs:** steps 3 and 4, D3, and a decision of its own on how a caller chooses it and what an update tells the callback.
- **Done when:** a watch that delivers live state keeps one object current through every change a snapshot or a change set would report, including lists that are reordered and items that come and go, applies each change before the callback sees it, and reports a failed evaluation without changing the state.
- **State:** not started.

### 8. The fluent builder

Build queries from calls that produce the same definition text or JSON would, so they resolve and read alike.

- **Needs:** nothing of the runtime; it works on definitions and resolution, which are built.
- **Done when:** the definition a builder produces equals the one the equivalent text parses to, for every construct the language has.
- **State:** not started.

### 9. Editor tooling

Diagnostics and completion over the grammar and the declaration metadata, without running a capability.

- **Needs:** nothing of the runtime.
- **Done when:** a query text is checked against the declarations available to its project, reporting the same positions and messages as resolution.
- **State:** not started.

### 10. The C# half

`Parse`, `TryParse`, typed mapping and snapshots for a .NET host.

- **Needs:** the JavaScript API settled (steps 1 to 7), D4.
- **State:** not started.

## Departures from the design

None yet. A departure is recorded here as it happens, with the reason, until the design is brought into line.
