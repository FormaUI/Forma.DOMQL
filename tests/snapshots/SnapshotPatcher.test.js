import { describe, it, expect } from 'vitest';
import { SnapshotPatcher } from '#domql/snapshots/SnapshotPatcher.mjs';

/** Immutable data, as a snapshot is. */
const freeze = value => (Array.isArray(value)
    ? Object.freeze(value.map(freeze))
    : value !== null && typeof value === 'object' ? Object.freeze(Object.fromEntries(Object.entries(value).map(([name, field]) => [name, freeze(field)]))) : value);

/** Elements that stand for themselves, by which a projected list is matched. */
const elements = (...names) => names.map(name => ({ nodeType: 1, name }));

/** The identities of a top-level shape whose field `rows` was projected from the elements. */
const rowsOf = rowElements => ({ fields: { rows: { elements: rowElements, items: rowElements.map(() => null) } } });

describe('SnapshotPatcher', () => {
    describe('between', () => {
        it('answers no operation for a result that did not change, shared or equal', () => {
            const result = freeze({ count: 3, rows: [{ key: 'a' }] });

            expect(SnapshotPatcher.between(result, null, result, null)).toEqual([]);
            expect(SnapshotPatcher.between(result, null, freeze({ count: 3, rows: [{ key: 'a' }] }), null)).toEqual([]);
        });

        it('replaces a field that changed, at its path', () => {
            const operations = SnapshotPatcher.between(freeze({ panel: { size: { width: 10, height: 5 } }, kind: 'list' }), null, freeze({ panel: { size: { width: 12, height: 5 } }, kind: 'list' }), null);

            expect(operations).toEqual([{ op: 'replace', path: '/panel/size/width', value: 12 }]);
        });

        it('replaces a value that became null or stopped being null, whole', () => {
            expect(SnapshotPatcher.between(freeze({ panel: { width: 1 } }), null, freeze({ panel: null }), null)).toEqual([{ op: 'replace', path: '/panel', value: null }]);
            expect(SnapshotPatcher.between(freeze({ panel: null }), null, freeze({ panel: { width: 1 } }), null)).toEqual([{ op: 'replace', path: '/panel', value: { width: 1 } }]);
        });

        it('replaces the whole result where it is no shape', () => {
            expect(SnapshotPatcher.between(3, null, 4, null)).toEqual([{ op: 'replace', path: '', value: 4 }]);
        });

        it('changes a list that is no projection of elements by position', () => {
            expect(SnapshotPatcher.between(freeze({ ids: [1, 2, 3] }), null, freeze({ ids: [1, 5, 3, 4] }), null)).toEqual([
                { op: 'replace', path: '/ids/1', value: 5 },
                { op: 'add', path: '/ids/3', value: 4 },
            ]);
            expect(SnapshotPatcher.between(freeze({ ids: [1, 2, 3] }), null, freeze({ ids: [1] }), null)).toEqual([
                { op: 'remove', path: '/ids/2' },
                { op: 'remove', path: '/ids/1' },
            ]);
        });

        it('adds and removes the items of elements entering and leaving a projected list', () => {
            const [a, b, c] = elements('a', 'b', 'c');
            const operations = SnapshotPatcher.between(
                freeze({ rows: [{ key: 'a' }, { key: 'b' }] }), rowsOf([a, b]),
                freeze({ rows: [{ key: 'a' }, { key: 'c' }] }), rowsOf([a, c]),
            );

            expect(operations).toEqual([
                { op: 'remove', path: '/rows/1' },
                { op: 'add', path: '/rows/1', value: { key: 'c' } },
            ]);
        });

        it('moves the item of an element that changed position, rather than rewriting the list', () => {
            const [a, b, c] = elements('a', 'b', 'c');
            const operations = SnapshotPatcher.between(
                freeze({ rows: [{ key: 'a' }, { key: 'b' }, { key: 'c' }] }), rowsOf([a, b, c]),
                freeze({ rows: [{ key: 'c' }, { key: 'a' }, { key: 'b' }] }), rowsOf([c, a, b]),
            );

            expect(operations).toEqual([{ op: 'move', from: '/rows/2', path: '/rows/0' }]);
        });

        it('moves and updates items in one change, each update at the item\'s new position', () => {
            const [a, b, c] = elements('a', 'b', 'c');
            const operations = SnapshotPatcher.between(
                freeze({ rows: [{ key: 'a', height: 1 }, { key: 'b', height: 2 }, { key: 'c', height: 3 }] }), rowsOf([a, b, c]),
                freeze({ rows: [{ key: 'b', height: 2 }, { key: 'c', height: 30 }, { key: 'a', height: 10 }] }), rowsOf([b, c, a]),
            );

            expect(operations).toEqual([
                { op: 'move', from: '/rows/1', path: '/rows/0' },
                { op: 'move', from: '/rows/2', path: '/rows/1' },
                { op: 'replace', path: '/rows/1/height', value: 30 },
                { op: 'replace', path: '/rows/2/height', value: 10 },
            ]);
        });

        it('tells apart two elements that project to the same data, by the element and never by the data', () => {
            const [a, b] = elements('a', 'b');

            // The two items swap places and the one now first changes: the change belongs to b, wherever its data stood before.
            const operations = SnapshotPatcher.between(
                freeze({ rows: [{ selected: false }, { selected: false }] }), rowsOf([a, b]),
                freeze({ rows: [{ selected: true }, { selected: false }] }), rowsOf([b, a]),
            );

            expect(operations).toEqual([
                { op: 'move', from: '/rows/1', path: '/rows/0' },
                { op: 'replace', path: '/rows/0/selected', value: true },
            ]);
        });

        it('matches by position a projected list in which an element stands twice or an item is null', () => {
            const [a, b] = elements('a', 'b');

            expect(SnapshotPatcher.between(freeze({ rows: [{ k: 1 }, { k: 1 }] }), rowsOf([a, a]), freeze({ rows: [{ k: 1 }, { k: 2 }] }), rowsOf([a, b]))).toEqual([
                { op: 'replace', path: '/rows/1/k', value: 2 },
            ]);
            expect(SnapshotPatcher.between(freeze({ rows: [null, { k: 1 }] }), rowsOf([null, a]), freeze({ rows: [{ k: 1 }, null] }), rowsOf([a, null]))).toEqual([
                { op: 'replace', path: '/rows/0', value: { k: 1 } },
                { op: 'replace', path: '/rows/1', value: null },
            ]);
        });

        it('escapes a name the way a JSON Pointer does', () => {
            expect(SnapshotPatcher.between(freeze({ 'a/b': 1, '~c': 1 }), null, freeze({ 'a/b': 2, '~c': 2 }), null)).toEqual([
                { op: 'replace', path: '/a~1b', value: 2 },
                { op: 'replace', path: '/~0c', value: 2 },
            ]);
        });
    });

    describe('apply', () => {
        const state = freeze({ count: 3, rows: [{ key: 'a' }, { key: 'b' }, { key: 'c' }], panel: { width: 10 } });

        it('replaces, adds, removes and moves, giving the result each operation describes', () => {
            expect(SnapshotPatcher.apply(state, [{ op: 'replace', path: '/panel/width', value: 12 }])).toEqual({ ...state, panel: { width: 12 } });
            expect(SnapshotPatcher.apply(state, [{ op: 'add', path: '/rows/1', value: { key: 'x' } }]).rows).toEqual([{ key: 'a' }, { key: 'x' }, { key: 'b' }, { key: 'c' }]);
            expect(SnapshotPatcher.apply(state, [{ op: 'add', path: '/rows/-', value: { key: 'z' } }]).rows.at(-1)).toEqual({ key: 'z' });
            expect(SnapshotPatcher.apply(state, [{ op: 'remove', path: '/rows/0' }]).rows).toEqual([{ key: 'b' }, { key: 'c' }]);
            expect(SnapshotPatcher.apply(state, [{ op: 'move', from: '/rows/2', path: '/rows/0' }]).rows).toEqual([{ key: 'c' }, { key: 'a' }, { key: 'b' }]);
            expect(SnapshotPatcher.apply(state, [{ op: 'replace', path: '', value: 7 }])).toBe(7);
        });

        it('leaves the state it was given as it was, and shares what the change does not reach', () => {
            const next = SnapshotPatcher.apply(state, [{ op: 'replace', path: '/rows/1/key', value: 'B' }]);

            expect(state.rows[1].key).toBe('b');
            expect(next.panel).toBe(state.panel);
            expect(next.rows[0]).toBe(state.rows[0]);
            expect(Object.isFrozen(next.rows[1])).toBe(true);
        });

        it('freezes what it adds, so a state built from a delivery stays immutable', () => {
            const next = SnapshotPatcher.apply(state, [{ op: 'add', path: '/rows/0', value: { key: 'n', tags: ['x'] } }]);

            expect(Object.isFrozen(next.rows[0])).toBe(true);
            expect(Object.isFrozen(next.rows[0].tags)).toBe(true);
        });

        it.each([
            ['a path past the end of a list', [{ op: 'replace', path: '/rows/3/key', value: 'x' }]],
            ['a field the result does not hold', [{ op: 'replace', path: '/missing', value: 1 }]],
            ['a path into a value that holds nothing', [{ op: 'replace', path: '/count/x', value: 1 }]],
            ['an index that is no number', [{ op: 'remove', path: '/rows/first' }]],
            ['an operation JSON Patch has but a change set does not', [{ op: 'copy', from: '/rows/0', path: '/rows/1' }]],
            ['a pointer without its leading slash', [{ op: 'remove', path: 'rows/0' }]],
            ['a later operation that fails after earlier ones applied', [{ op: 'remove', path: '/rows/0' }, { op: 'remove', path: '/rows/5' }]],
        ])('refuses %s, whole, leaving the state untouched', (_, operations) => {
            const before = JSON.stringify(state);

            expect(() => SnapshotPatcher.apply(state, operations)).toThrow(TypeError);
            expect(JSON.stringify(state)).toBe(before);
        });
    });

    describe('between, then apply', () => {
        it.each([
            ['fields, nulls and positional lists', freeze({ a: 1, b: { c: [1, 2] }, d: null }), null, freeze({ a: 2, b: { c: [2] }, d: { e: 'x' } }), null],
            ['a projected list reordered, updated, grown and shrunk at once', ...(() => {
                const [a, b, c, d, e] = elements('a', 'b', 'c', 'd', 'e');

                return [
                    freeze({ rows: [{ k: 'a', n: 1 }, { k: 'b', n: 2 }, { k: 'c', n: 3 }, { k: 'd', n: 4 }] }), rowsOf([a, b, c, d]),
                    freeze({ rows: [{ k: 'd', n: 4 }, { k: 'e', n: 5 }, { k: 'b', n: 20 }, { k: 'a', n: 1 }] }), rowsOf([d, e, b, a]),
                ];
            })()],
            ['projected items that hold the same data', ...(() => {
                const [a, b, c] = elements('a', 'b', 'c');

                return [freeze({ rows: [{ x: 0 }, { x: 0 }, { x: 0 }] }), rowsOf([a, b, c]), freeze({ rows: [{ x: 0 }, { x: 1 }, { x: 0 }] }), rowsOf([c, a, b])];
            })()],
        ])('give the next result when the change set is applied to the previous one: %s', (_, previous, previousIdentities, next, nextIdentities) => {
            expect(SnapshotPatcher.apply(previous, SnapshotPatcher.between(previous, previousIdentities, next, nextIdentities))).toEqual(next);
        });
    });
});
