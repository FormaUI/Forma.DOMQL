# DOMQL

DOMQL, a small query language over the DOM. **A JavaScript library · ES modules in `src/` · bundled to one minified file · published as the NuGet package `formaui-net.DOMQL`.**

The language knows only the DOM, and nothing here refers to a consumer of it.

## Source of truth

- Do use the [DOMQL specification](docs/domql-specification.md) for what the language means: its syntax, resolution, values, requests, evaluation semantics, vocabulary contracts and the definition. It is authoritative; code follows it, and a change to the language changes it first.
- Do use the [DOMQL design](docs/domql-design.md) for how DOMQL runs and is used: preparation, waiting and sessions, watching, change sets and recovery, occurrence delivery, modules, tooling and the authoring APIs.
- Do use the [implementation plan](docs/domql-implementation-plan.md) for the steps that build what is not built yet, their state and the open decisions; mark a step done when its work is finished and nothing remains, and record a departure from the design there until the design is brought into line.
- Do read `.editorconfig` before writing C#; it is the authority on style.
- Don't invent scope, status or style rules when an authoritative file defines them.

## Structure

- Do keep the language's scripts under `src/`: the `domql.js` entry, composing the modules beside it, and those modules in three folders. `language/` holds what needs no browser: a query as text and as a definition, the types, resolving a definition against the vocabulary, and a DOMQL failure and its location; the modules, their registry and the built-in vocabulary's declarations are in `language/vocabulary/`. `dom/` holds what works on a window and its document: reading a resolved definition, the observations and the sessions that reach them, and the functions that carry out the built-in vocabulary. `snapshots/` computes, compares, dispatches and applies snapshot updates, using identity metadata without reading or observing the DOM. Add a folder when a responsibility arrives.
- Do let `dom/` depend on `language/` and `snapshots/`, and `snapshots/` on `language/` alone, never the other way, and let `dom/` receive the window and the document it works on, never reach for a global. Importing `language/` and resolving a query works without a DOM.
- Do keep the package project, which only carries the bundle to NuGet, in `nuget/`, the tests in `tests/`, and the script that bundles in `scripts/`.
- Do keep experiments, spikes and notes that belong to a person under `.local/`, which git ignores whole.
- Do write each module as one concept expressed as a class, taking its collaborators once in its constructor, with `#`-private mechanics; a family of pure helpers is a class with static members.
- Do keep the entry composing its modules rather than re-exporting them.
- Do keep DOMQL free of any consumer: no reference to Forma, a component, Blazor, a watcher or an engine, in code, comments or documents.
- Do keep a module's registration apart from the instances it creates, as the design sets out.

## Scripts

- Do use only native modern browser APIs in `src/`, with no external library or polyfill; a script is an ES module, strict by construction.
- Do publish DOMQL as one minified file, `nuget/wwwroot/domql.js`, which `scripts/bundle.mjs` makes from `src/` with esbuild, a development dependency that the package never carries; the file is generated, ignored by git, and as small as the sources allow, and a test runs the bundle. Ship its types beside it as `domql.d.ts`, written by hand in `src/` and copied by the same script; a test compiles a TypeScript caller against it and fails when it and `Domql` disagree.
- Do name a parameter by its role (`text`, `definition`, `bindings`), never its type.
- Do give the plain name to an operation that answers directly, and the suffix `Async` to every operation that answers a promise: `read` and `readAsync`. Never suffix the synchronous form.
- Do write the language's name as DOMQL in prose and `Domql` in code, and name a module that exposes a capability through DOMQL `{Capability}DomqlModule`.
- Do report every failure where it happens, as a `DomqlError` naming where it fails, and never swallow a rejection.
- Do give every cache a stated validity and release, and show the work it saves by measurement.

## Tests

- Do add or change a test for every module you add or change, in `tests/`, and run them with `npm test` from that folder.
- Do put a test where the code it tests is, `tests/` following `src/` folder for folder, and name a test of layout, geometry or state the browser decides `*.browser.js`, beside the others, which runs in headless Chromium with `npm run test:browser` or `./build.ps1 -Browser`; the happy-dom tests lay nothing out.
- Do test through the public surface, `Domql` and what it returns, and assert exact definitions, error kinds and locations.
- Don't wait on the clock for work a test controls.

## Documentation

- Do state in the specification what the language means, with examples that make the contract precise, and in the design how it runs; neither restates the other.
- Do version the specification as major.minor.revision: raise the revision with every change to it, the minor when the language gains something compatible and the major when it breaks one; the design's title, `Specification.mjs` and the package's version follow in the same change, and the alignment test fails when they disagree. The package is `major.minor.0-preview.revision` while it is a preview, and `major.minor.patch` once it is not.
- Do keep every example in the documents a valid query, parsed by the implementation.
- Do say what a thing is in a comment or summary, never how or why.

## Build and verification

The gate is `./build.ps1`: the tests, the bundle, the package project's build with no warnings, and the format check; `./publish.ps1` runs it and packs the package.

- Do treat every compiler warning as a build failure.

## Working agreement

- Do present a piece of work for review and stop; iterate on it until the maintainer declares it complete.
- Do finish a piece of work with it unstaged, report what changed and what the gate said, and propose a commit message for the maintainer to run themselves.
- Do keep changes minimal and on-scope.
- Don't run a state-changing Git command, `add`, `commit`, `push`, `reset`, `restore`, `stash`, a path-scoped `checkout`, without permission for that command, asked for once the work exists.

## Commit messages

A commit message describes the durable change the commit introduces, never the session that produced it.

- Do make the title summarize the entire commit, and split a commit one honest title cannot cover.
- Do add a body only where the title alone is not enough.
- Don't describe how the change was implemented, narrate attempts, enumerate files or members, or report test counts or routine verification.
- Don't append an attribution trailer such as `Co-Authored-By`.
