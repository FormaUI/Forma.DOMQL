# DOMQL

DOMQL, the query language a caller asks the browser about a document in, as the [DOMQL specification](https://github.com/FormaUI/Forma.DOMQL/blob/main/docs/domql-specification.md) defines it and the [DOMQL design](https://github.com/FormaUI/Forma.DOMQL/blob/main/docs/domql-design.md) sets out how it runs. The package serves it as one minified file, `domql.js`, from `_content/DOMQL/`.

## Creating a query

`Domql.parse` reads a query's text and `Domql.create` takes its definition, each binding the query's parameters by name; both check the query's structure and throw a `DomqlError` naming where it fails.

```js
import { Domql } from '/_content/DOMQL/domql.js';

const query = Domql.parse(`
    @panel {
        size,
        hasFocus: matches(":focus-within")
    }
`, { panel });

const another = Domql.create(query.definition, { panel: otherPanel });
```

A query's `definition` is the JSON document recording its meaning, frozen and shared by every query parsed from the same text; its `bindings` hold the values its parameters are bound to.
