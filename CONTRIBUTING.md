# Contributing to DOMQL

Thank you for taking an interest in DOMQL. This page says how a change is made and checked.

## Before you start

Open an issue first for anything beyond a small fix, so the change can be discussed before work goes into it. A change to the language itself starts in the [specification](docs/domql-specification.md), which is authoritative: the code follows it, and a change that the specification does not describe is not a change to the language. How DOMQL runs is the [design](docs/domql-design.md)'s concern. The [README](README.md#status) lists what is built and what is planned, and the [implementation plan](docs/domql-implementation-plan.md) says in what order the rest is built and which decisions are open.

## Set up

DOMQL is a JavaScript library with a small .NET project that packages it. You need Node.js with npm, PowerShell, and the .NET SDK that `nuget/global.json` pins, which is a .NET 11 release candidate while DOMQL is a preview.

```sh
cd tests
npm install
npm test
```

## Check a change

`./build.ps1` is the gate. It runs the tests, bundles `src/`, builds the package project with no warnings and checks the formatting. A change is ready when the gate passes. CI runs the gate, with the browser tests, on Linux for every push to `main` and every pull request.

- Add or change a test for every module you add or change. Tests live in `tests/`, mirror the folders of `src/`, and test through the public API, `Domql`.
- Give a test that registers a module its own `ModuleRegistry`, or its own copy of `Domql`, so tests pass in any order.
- Use simulated-DOM tests for structure and attributes. The test environment lays nothing out, so a test of layout, geometry or state the browser decides goes in a `*.browser.js` file beside the tests of the same code, which runs in headless Chromium: `./build.ps1 -Browser`, or `npm run test:browser` from `tests/`.
- An example in the package README is a test: it is kept as a fixture in `tests/readme/`, and a change to the README's examples changes the fixtures and the answers they expect.
- Write code as the surrounding code is written. `.editorconfig` is the authority on style, and every compiler warning is a build failure.

## Commit

Write [Conventional Commits](https://www.conventionalcommits.org): `type(scope): description`, a subject under 50 characters, and a body, wrapped at 72 characters, that says what the change does for its user and why, never how it was made. Keep each commit to one change that builds and passes on its own. Leave out attribution trailers.

## Report a problem

A bug report is most useful with the query, the document it ran against, the answer you expected and the answer you got. For a security problem, follow [SECURITY.md](SECURITY.md) instead of opening an issue.
