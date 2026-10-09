# Security policy

## Reporting a vulnerability

Please report a vulnerability privately, not in a public issue.

- Use GitHub's **Report a vulnerability** on the repository's Security tab, or
- write to domql@formaui.net.

Say what you found, how to reproduce it, and which version it affects. You will get an answer once the report has been read, and the report is kept private until a fix is available or a disclosure is agreed with you.

## Supported versions

DOMQL is a preview. Only the latest version receives fixes.

## What counts

DOMQL runs in the browser and reads the document it is given, answering data. These reports are in scope:

- a query that changes the document, runs script or reaches data it was not given, since reading never writes;
- an answer that leaks a live reference to the document instead of detached data;
- a crafted query text or definition that makes the library hang, fail in a way other than a `DomqlError`, or consume unbounded resources.

A module that a host registers runs with the host's authority, so what a module's functions do is the host's responsibility, not a vulnerability in DOMQL.
