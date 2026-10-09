# Forma.DOMQL

DOMQL, a small query language over the DOM. **ES modules · no build step · .NET 11 Razor class library for packaging · package `formaui-net.DOMQL`.**

The language knows only the DOM. It was designed beside the sibling **Forma** repository (`c:\Users\eyal\Development\Projects\formaui-net`), whose DOM watcher and engine are its first consumer and reference it from a checkout beside their own; nothing here refers back to Forma.

## Source of truth

- Do use the [DOMQL specification](docs/domql-specification.md) for what the language means: its syntax, resolution, values, requests, evaluation semantics, vocabulary contracts and the definition. It is authoritative; code follows it, and a change to the language changes it first.
- Do use the [DOMQL design](docs/domql-design.md) for how DOMQL runs and is used: preparation, waiting and leases, watching, change sets and recovery, occurrence delivery, modules, tooling and the authoring APIs.
- Do read `.editorconfig` before writing C#; it is the authority on style.
- Don't invent scope, status or style rules when an authoritative file defines them.

## Structure

- Do keep the language's scripts under `src/Forma.DOMQL/wwwroot/scripts/`: the `Domql.js` entry, composing the modules beside it, and those modules in folders named for what they hold, such as `language/`.
- Do write each module as one concept expressed as a class, taking its collaborators once in its constructor, with `#`-private mechanics; a family of pure helpers is a class with static members.
- Do keep the entry composing its modules rather than re-exporting them.
- Do keep DOMQL free of any consumer: no reference to Forma, a component, Blazor, a watcher or an engine, in code, comments or documents.
- Do keep a module's registration apart from the instances it creates, as the design sets out.

## Scripts

- Do use only native modern browser APIs, with no external library, polyfill, bundler or build step; a script is an ES module, strict by construction.
- Do name a parameter by its role (`text`, `definition`, `bindings`), never its type.
- Do write the language's name as DOMQL in prose and `Domql` in code, and name a module that exposes a capability through DOMQL `{Capability}DomqlModule`.
- Do report every failure where it happens, as a `DomqlError` naming where it fails, and never swallow a rejection.
- Do give every cache a stated validity and release, and show the work it saves by measurement.

## Tests

- Do add or change a test beside every module you add or change, in `tests/Forma.DOMQL.Tests.Scripts/`, laid out as `wwwroot/scripts/` is, and run them with `npm test` from that folder.
- Do test through the public surface, `Domql` and what it returns, and assert exact definitions, error kinds and locations.
- Don't wait on the clock for work a test controls.

## Documentation

- Do state in the specification what the language means, with examples that make the contract precise, and in the design how it runs; neither restates the other.
- Do keep every example in the documents a valid query, parsed by the implementation.
- Do say what a thing is in a comment or summary, never how or why.

## Build and verification

The gate is `./build.ps1`: the build with no warnings, the script tests, and the format check.

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
