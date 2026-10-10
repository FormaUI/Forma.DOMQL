import { bench, describe } from 'vitest';
import { Domql } from '#domql/domql.js';

/** How many rows a table holds. */
const ROWS = 1000;

/** The row the workloads that change one row change. */
const CHANGED = ROWS / 2;

/** Each row as data: its key, whether it is selected, and its box. */
const ROWS_TEXT = '@table.all("tr") { key: attributeOf("data-key"), selected: matches(".selected"), box: rect { width, height } }';

/** A table of rows, in the document, each with a key. */
const createTable = () => {
    const table = document.createElement('table');
    const body = document.createElement('tbody');

    for (let index = 0; index < ROWS; index++) {
        const row = document.createElement('tr');

        row.setAttribute('data-key', `r${index}`);
        row.className = index % 7 === 0 ? 'selected' : '';
        body.append(row);
    }

    table.append(body);
    document.body.append(table);

    return table;
};

// A watch is refreshed by the workload alone, so no frame evaluates it between iterations.
window.requestAnimationFrame = () => 1;
window.cancelAnimationFrame = () => {};

describe('read', () => {
    const table = createTable();
    const panel = document.createElement('div');

    panel.setAttribute('data-key', 'panel');
    document.body.append(panel);

    const rows = Domql.parse(ROWS_TEXT, { table });
    const small = Domql.parse('@panel { key: attributeOf("data-key"), open: matches(".open"), count: children.count }', { panel });

    bench(`a list of ${ROWS} rows, each shaped`, () => {
        Domql.read(rows);
    });

    bench('a small shape, as a query', () => {
        Domql.read(small);
    });

    bench('a small shape, from its text and bindings', () => {
        Domql.read('@panel { key: attributeOf("data-key"), open: matches(".open"), count: children.count }', { panel });
    });
});

describe(`a watch of ${ROWS} rows, refreshed`, () => {
    /** A watch of a table of its own, and the table's row that changes. */
    const createWatch = updateStrategy => {
        const table = createTable();
        const watch = Domql.watch(Domql.parse(ROWS_TEXT, { table }), {
            updateStrategy,
            acceptPartialObservation: true,
            // A change set is acknowledged as soon as it arrives, so the next is computed against it.
            onChange: update => (updateStrategy === 'changeSet' ? watch.acknowledge(update) : undefined),
        });

        return { watch, row: table.querySelectorAll('tr')[CHANGED] };
    };

    const unchanged = createWatch('snapshot');
    const snapshots = createWatch('snapshot');
    const changeSets = createWatch('changeSet');
    const liveState = createWatch('liveState');

    bench('unchanged', async () => {
        await unchanged.watch.refreshAsync();
    });

    bench('one row changed, delivering snapshots', async () => {
        snapshots.row.classList.toggle('selected');
        await snapshots.watch.refreshAsync();
    });

    bench('one row changed, delivering change sets', async () => {
        changeSets.row.classList.toggle('selected');
        await changeSets.watch.refreshAsync();
    });

    bench('one row changed, keeping live state', async () => {
        liveState.row.classList.toggle('selected');
        await liveState.watch.refreshAsync();
    });
});
