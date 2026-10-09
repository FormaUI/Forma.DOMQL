# DOMQL Implementation Plan

This plan records the steps that take DOMQL from what is built to what the [specification](domql-specification.md) and the [design](domql-design.md) describe, the decisions that shape them, the state of each step, and where the work departs from the design. The design is authoritative; this plan changes with the work and is retired when every step is done.

## Built

Each item is what exists and what checks it.

- **The language.** Parsing text and creating queries from their definition, with the position of every mistake. Checked by the tests of parsing and of the definition.
- **The vocabulary.** The core vocabulary declared as module data, and modules that extend it. Checked by the tests of modules, the registry and the vocabulary.
- **Resolution.** Resolving a definition against the vocabulary and typing its answer, without a browser; the resolution is kept for its query. Checked by the resolver tests and the tests of `Domql.resolve`.
- **Reading once.** Synchronous reads of every core member except `intersects`, which is maintained, and `events-of`, which is an occurrence source; both fail a read with an evaluation error that says so. A read answers detached, immutable data. Checked by the evaluator tests, in a simulated DOM, and by the browser tests, in Chromium, for geometry and for state the browser decides.
- **The package.** The bundle, with its TypeScript declarations checked against `Domql` and against a TypeScript caller; the READMEs' examples run as tests.

What is not built: members kept by an observation, watching, occurrence sources, actions and behaviors, the fluent builder, the C# half and editor tooling.

## Decisions

Each decision is open until its state says otherwise, and a step that needs it does not start before.

### D1. How a declaration names its change sources

A declaration states how a member changes as a category. A watch needs the sources themselves.

- **Recommended: sources are named kinds.** A declaration lists the sources that cover its changes, each a named kind with its target and the arguments that matter to it, such as `{ kind: 'resize', of: 'receiver' }`. The core defines the kinds it observes with: resize, attributes and structure, intersection, media query, focus and selection events, and document visibility. A module can contribute kinds of its own, each with the function that starts the observation and releases it. Declarations stay data, so a tool reads them without running anything, and a custom source stays possible.
- **Two contracts, one lifecycle.** An *invalidation source* says that the answer may have changed and the query should be evaluated again; it carries no value. A *maintained source* provides a sampled value that a member reads, and is pending until its first sample. Both are started, shared and released the same way; their contracts differ and a kind is one or the other.
- **Identity.** Equivalent observation requests share an underlying observation where their kind permits it. A request's identity is its kind, its target, the arguments that change what is observed, such as an intersection's root and margin or the attributes an observation filters on, and the DOM environment it belongs to. A kind states which of its arguments belong to the identity and whether sharing is permitted at all.
- **Alternative: a function per member.** A member supplies a function that subscribes and returns its release. It is the most flexible and leaves nothing for a tool to read.

State: open. Needed by steps 1 to 3.

### D2. How a read waits

The design has a read wait for the first sample of every maintained member it reads, and a wait cannot be synchronous.

- **Recommended:** `Domql.read` stays synchronous and fails with an evaluation error for a query that reads a maintained member, as it does today, naming the member. `Domql.readAsync(query, { signal, window })` answers a promise, waits for samples, and can be canceled; it also reads a query with no maintained member, so a caller can use it for every query.
- **Guarantees of `readAsync`.**
  - Cancellation and failure release every lease the read acquired.
  - Waiting evaluates again as samples arrive and as dependencies change. It never answers while a maintained member the answer reads is still pending, including one that a later evaluation introduced.
  - The answer uses fresh reads and the samples available when the last evaluation ran. It does not promise that every measurement was taken at the same instant.
- **Alternative:** `read` answers a promise for every query.

The design's wording changes to the chosen names when this is settled. State: open. Needed by step 2.

### D3. The public API of a watch and a listener

- **Recommended:** `Domql.watch(query, options)` answers a handle, and `Domql.listen(query, options)` answers a handle for a subscription. The options choose the schedule, the delivery, whether the watch accepts partial observation, and the callbacks. A caller chooses where an answer is delivered; DOMQL never decides it.
- **Readiness.** A handle has a `status` of `pending` until the first evaluation completes, `ready` once it has an answer, and `failed` after an evaluation fails, and the answer, which can be null, is read beside the status, never in place of it. A failed watch keeps running, as the design describes, and its status returns to `ready` with its next successful evaluation.
- **The first answer.** It is delivered through the same callback as every later one, as the baseline, so a caller has one path for all of them.
- **`refresh()`.** It answers a promise that settles when the evaluation it caused has completed and the delivery it produced, if any, has been handed to the callback and the callback has returned. A refresh pending when the handle is disposed settles without delivering.
- **A failing callback.** A callback that throws, or whose promise rejects, leaves the state it was handed accepted, as the design says, and the failure is reported to the failure callback; it does not stop the watch.
- **`dispose()`.** It cancels scheduled evaluation, releases every lease, and guarantees that no callback runs after it returns.
- **Delivery kinds.** A snapshot is immutable and never changes once delivered. A change set is relative to the state it was computed against. Live state is one object with a stable identity, updated in place, so it is chosen explicitly and is never a snapshot.
- **A listener.** It delivers each occurrence's answer through its callback, with the same failure and disposal rules.

State: open. Needed by steps 3 to 5.

### D4. What DOMQL owns and what a host owns

State: **accepted.**

- **DOMQL owns** the semantics every host shares: evaluation, dependency recording, observation leases, snapshots, baselines, revisions, change-set computation and the atomic application of a change set. It also owns the ordering rules that stop a stale update from being accepted.
- **A host owns** transport, acknowledgments, reconnection, who owns a watch, and asking for a replacement baseline when its receiver cannot be trusted.
- **A host never keeps a second watch or patch implementation.** A baseline is how a host recovers; DOMQL does not know what a connection is.

### D5. The API of actions and behaviors

- **Recommended:** `Domql.run(query, options)` runs an action once and answers a promise of its result. `Domql.establish(query, options)` answers a handle for a behavior with `update(bindings)` and `dispose()`; the instance belongs to the caller that established it, and releasing it leaves its module registered. A query never runs either.

State: open. Needed by step 6.

## Steps

A step is done when its tests pass in the gate, its documents say what it built, and its state here says so.

### 1. Change sources and observations

Name the change sources a declaration carries (D1), and build the layer that starts, shares and releases observations under leases: equivalent requests share one observation, started on first use and released when the last holder lets go.

- **Needs:** D1.
- **Done when:** every member of the core vocabulary names its sources, each as an invalidation source or a maintained one; a lease starts an observation once for equivalent requests and ends it when the last is released; requests that differ in an argument that belongs to the identity do not share; each source reports a change in a real browser.
- **State:** not started.

### 2. Dependencies and maintained members

Record what an evaluation read, member by member and item by item, with each member's sources. Read maintained members from their observation's latest sample, pending until the first arrives, and build the waiting read.

- **Needs:** step 1, D2.
- **Done when:** a query's dependencies are the ones the design lists, including those of expression arguments, of a path that met null and of a detached element; `intersects` reads in a real browser; `readAsync` waits for the first sample, evaluates again for a member a later evaluation introduces, and releases its leases on cancellation and on failure.
- **State:** not started.

### 3. Watches

Evaluate, report and evaluate again when a source fires, reporting only an answer that differs: the schedule, the subscriptions that follow the dependencies, the comparison with a member's tolerance, a failed evaluation, an element that leaves the document and returns, and acceptance of partial observation. Snapshots are the first delivery.

- **Needs:** steps 1 and 2, D3.
- **Done when:** a watch follows the document as the design describes; its status, first delivery, refresh, failing callback and disposal behave as D3 defines; it delivers snapshots that share their unchanged parts, and releases every lease when it ends.
- **State:** not started.

### 4. Change sets and recovery

Deliver a baseline and then change sets as JSON Patch limited to `replace`, `add`, `remove` and `move`, with coalescing and the rules of ordering that recovery relies on: DOMQL numbers its baselines and revisions, accepts a change set only against the state it was computed against, applies it atomically, and gives a stale update no effect.

- **Needs:** step 3, D4.
- **Done when:** applying each change set to the state it was computed against gives the next answer; the design's rules of recovery hold under failed, late and out-of-order deliveries; a host that asks for a replacement baseline gets one that nothing earlier can affect.
- **List projections** keep an internal identity for each element they project, so a change set expresses insertions, removals and moves without an answer holding an element reference. Tests include projected values that repeat, and a list that is reordered and updated in one change.
- **State:** not started.

### 5. Occurrence sources

Deliver what an occurrence source reports: `events-of` captures what the event carries at dispatch, the shape after it is evaluated for each occurrence, and the leases its shapes acquire are held across occurrences.

- **Needs:** steps 1 and 2, D3.
- **Done when:** a subscription delivers one immutable answer for each occurrence and releases everything when it ends. Its tests include:
  - the first occurrence answering null for a maintained member whose sample is still pending, and a later occurrence reading the sample that arrived;
  - an evaluation that depends on different members from the one before it keeping what it reads and releasing the rest;
  - a failed projection delivering nothing, keeping the leases it held before and releasing those the failed attempt acquired.
- **State:** not started.

### 6. Actions and behaviors

Run an action once and receive its result, and establish, update and release a behavior whose instance belongs to its caller. Registering a module makes its capability understood; establishing a behavior creates an instance.

- **Needs:** D5; independent of steps 1 to 5.
- **Done when:** an extension's action and behavior run through their request kinds, a query never performs either, and releasing an instance leaves its module registered.
- **State:** not started.

### 7. The fluent builder

Build queries from calls that produce the same definition text or JSON would, so they resolve and read alike.

- **Needs:** nothing of the runtime; it works on definitions and resolution, which are built.
- **Done when:** the definition a builder produces equals the one the equivalent text parses to, for every construct the language has.
- **State:** not started.

### 8. Editor tooling

Diagnostics and completion over the grammar and the declaration metadata, without running a capability.

- **Needs:** nothing of the runtime.
- **Done when:** a query text is checked against the declarations available to its project, reporting the same positions and messages as resolution.
- **State:** not started.

### 9. The C# half

`Parse`, `TryParse`, typed mapping and snapshots for a .NET host.

- **Needs:** the JavaScript API settled (steps 1 to 6), D4.
- **State:** not started.

## Departures from the design

None yet. A departure is recorded here as it happens, with the reason, until the design is brought into line.
