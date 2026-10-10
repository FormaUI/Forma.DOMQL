import { describe, it, expect } from 'vitest';
import { LiveState } from '#domql/snapshots/LiveState.mjs';
import { SnapshotPatcher } from '#domql/snapshots/SnapshotPatcher.mjs';

/** Immutable data, as a snapshot is. */
const freeze = value => (Array.isArray(value)
    ? Object.freeze(value.map(freeze))
    : value !== null && typeof value === 'object' ? Object.freeze(Object.fromEntries(Object.entries(value).map(([name, field]) => [name, freeze(field)]))) : value);

/** Elements that stand for themselves, by which a projected list is matched. */
const elements = (...names) => names.map(name => ({ nodeType: 1, name }));

/** The identities of a top-level shape whose field `rows` was projected from the elements. */
const rowsOf = rowElements => ({ fields: { rows: { elements: rowElements, items: rowElements.map(() => null) } } });

describe('LiveState', () => {
    it('is null before its first snapshot, which builds it as mutable data and changes nothing', () => {
        const live = new LiveState();
        const snapshot = freeze({ count: 1, rows: [{ k: 'a' }] });

        expect(live.state).toBeNull();
        expect(live.update(snapshot, null)).toEqual([]);
        expect(live.state).toEqual(snapshot);
        expect(live.state).not.toBe(snapshot);
        expect(Object.isFrozen(live.state)).toBe(false);
        expect(Object.isFrozen(live.state.rows[0])).toBe(false);
    });

    it('keeps one object, brought to each snapshot in place, and returns the change set that did, frozen', () => {
        const live = new LiveState();
        const first = freeze({ panel: { width: 10 }, count: 1 });
        const second = freeze({ panel: { width: 12 }, count: 1 });

        live.update(first, null);

        const { state } = live;
        const { panel } = state;
        const changes = live.update(second, null);

        expect(live.state).toBe(state);
        expect(state.panel).toBe(panel);
        expect(state).toEqual(second);
        expect(changes).toEqual(SnapshotPatcher.between(first, null, second, null));
        expect(Object.isFrozen(changes)).toBe(true);
        expect(Object.isFrozen(changes[0])).toBe(true);
    });

    it('keeps the object of each item of a list projected from elements as the list is reordered, grown and shrunk', () => {
        const live = new LiveState();
        const [a, b, c, d] = elements('a', 'b', 'c', 'd');

        live.update(freeze({ rows: [{ k: 'a', n: 1 }, { k: 'b', n: 2 }, { k: 'c', n: 3 }] }), rowsOf([a, b, c]));

        const [rowA, rowB] = live.state.rows;

        live.update(freeze({ rows: [{ k: 'b', n: 20 }, { k: 'd', n: 4 }, { k: 'a', n: 1 }] }), rowsOf([b, d, a]));

        expect(live.state.rows).toEqual([{ k: 'b', n: 20 }, { k: 'd', n: 4 }, { k: 'a', n: 1 }]);
        expect(live.state.rows[0]).toBe(rowB);
        expect(live.state.rows[2]).toBe(rowA);
    });

    it('makes a branch a new object only where its value stopped being one', () => {
        const live = new LiveState();

        live.update(freeze({ panel: { width: 1 } }), null);

        const { panel } = live.state;

        live.update(freeze({ panel: null }), null);
        live.update(freeze({ panel: { width: 1 } }), null);

        expect(live.state.panel).toEqual({ width: 1 });
        expect(live.state.panel).not.toBe(panel);
    });

    it('keeps a list at the root as one list', () => {
        const live = new LiveState();

        live.update(freeze([1, 2]), null);

        const { state } = live;

        live.update(freeze([1, 2, 3]), null);

        expect(live.state).toBe(state);
        expect(state).toEqual([1, 2, 3]);
    });
});
