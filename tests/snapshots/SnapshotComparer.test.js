import { describe, it, expect } from 'vitest';
import { SnapshotComparer } from '#domql/snapshots/SnapshotComparer.mjs';
import { Domql } from '#domql/domql.js';
import { LanguageResolver } from '#domql/language/LanguageResolver.mjs';
import { DomqlModule } from '#domql/language/vocabulary/DomqlModule.mjs';
import { ModuleRegistry } from '#domql/language/vocabulary/ModuleRegistry.mjs';
import { Vocabulary } from '#domql/language/vocabulary/Vocabulary.mjs';

/** A module of a size with the tolerance the test gives it, and one of a number with none. */
const property = (name, result, tolerance = {}) => new DomqlModule(name, {
    members: [{ name, function: name, kind: 'property', on: 'element', parameters: [], result, changes: 'constant', reads: 'fresh', ...tolerance }],
}, null);

/** The comparer of the snapshots of a query, which compares them as a watch does. */
const snapshotComparerOf = (text, bindings = {}, tolerance = {}) => {
    const registry = new ModuleRegistry([Vocabulary.module, property('wobble', 'size', tolerance), property('steady', 'number')]);
    const query = Domql.parse(text, bindings);
    const resolved = new LanguageResolver(registry, query.bindings, null, {}).resolveDefinition(query.definition);

    return new SnapshotComparer(resolved);
};

const freeze = value => (Array.isArray(value) ? Object.freeze(value.map(freeze)) : (value !== null && typeof value === 'object' ? Object.freeze(Object.fromEntries(Object.entries(value).map(([name, field]) => [name, freeze(field)]))) : value));

describe('SnapshotComparer', () => {
    const element = document.createElement('div');

    describe('reconcile', () => {
        it('gives the previous snapshot itself where nothing changed', () => {
            const snapshotComparer = snapshotComparerOf('@element { a: attributeOf "a", b: attributeOf "b" }', { element });
            const previous = freeze({ a: '1', b: '2' });

            expect(snapshotComparer.reconcile(previous, null, freeze({ a: '1', b: '2' }), null)).toBe(previous);
        });

        it('shares every branch that did not change and builds new ones along the paths that did', () => {
            const snapshotComparer = snapshotComparerOf('@element { id: attributeOf "id", items: children { key: attributeOf "key" } }', { element });
            const previous = freeze({ id: 'x', items: [{ key: 'a' }, { key: 'b' }] });
            const next = snapshotComparer.reconcile(previous, null, freeze({ id: 'x', items: [{ key: 'a' }, { key: 'c' }] }), null);

            expect(next).not.toBe(previous);
            expect(next.items).not.toBe(previous.items);
            expect(next.items[0]).toBe(previous.items[0]);
            expect(next.items[1]).toEqual({ key: 'c' });
            expect(Object.isFrozen(next.items)).toBe(true);
        });

        it('compares a list by position, and gives a new one where its length changed', () => {
            const snapshotComparer = snapshotComparerOf('@element { items: children { key: attributeOf "key" } }', { element });
            const previous = freeze({ items: [{ key: 'a' }, { key: 'b' }] });
            const next = snapshotComparer.reconcile(previous, null, freeze({ items: [{ key: 'a' }] }), null);

            expect(next.items).toEqual([{ key: 'a' }]);
            expect(next.items[0]).toBe(previous.items[0]);
        });

        it('compares strings, Booleans and null exactly', () => {
            const snapshotComparer = snapshotComparerOf('@element { s: attributeOf "s", b: matches ".x", n: attributeOf "none" }', { element });
            const previous = freeze({ s: 'a', b: true, n: null });

            expect(snapshotComparer.reconcile(previous, null, freeze({ s: 'a', b: true, n: null }), null)).toBe(previous);
            expect(snapshotComparer.reconcile(previous, null, freeze({ s: 'a', b: false, n: null }), null).b).toBe(false);
            expect(snapshotComparer.reconcile(previous, null, freeze({ s: 'a', b: true, n: 'x' }), null).n).toBe('x');
        });

        it('compares a number exactly where its member declares no tolerance', () => {
            const snapshotComparer = snapshotComparerOf('@element { n: steady }', { element });
            const previous = freeze({ n: 10 });

            expect(snapshotComparer.reconcile(previous, null, freeze({ n: 10.001 }), null).n).toBe(10.001);
            expect(snapshotComparer.reconcile(previous, null, freeze({ n: 10 }), null)).toBe(previous);
        });

        it('compares a number within the tolerance of the member that produced it', () => {
            const snapshotComparer = snapshotComparerOf('@element { size: wobble }', { element }, { tolerance: 0.5 });
            const previous = freeze({ size: { width: 100, height: 40 } });

            expect(snapshotComparer.reconcile(previous, null, freeze({ size: { width: 100.4, height: 39.6 } }), null)).toBe(previous);

            const next = snapshotComparer.reconcile(previous, null, freeze({ size: { width: 100.6, height: 40 } }), null);

            expect(next.size.width).toBe(100.6);
            expect(next.size.height).toBe(40);
        });

        it('shares the tolerance of a member with the fields of its value', () => {
            const snapshotComparer = snapshotComparerOf('@element { width: wobble.width }', { element }, { tolerance: 2 });
            const previous = freeze({ width: 100 });

            expect(snapshotComparer.reconcile(previous, null, freeze({ width: 101.5 }), null)).toBe(previous);
            expect(snapshotComparer.reconcile(previous, null, freeze({ width: 102.5 }), null).width).toBe(102.5);
        });

        it('keeps a number that moved within the tolerance at the one last reported, so the drift cannot add up', () => {
            const snapshotComparer = snapshotComparerOf('@element.wobble.width', { element }, { tolerance: 1 });
            let reported = 100;

            for (const width of [100.6, 101.2, 100.9]) {
                reported = snapshotComparer.reconcile(reported, null, width, null);
            }

            expect(reported).toBe(101.2);
        });

        it('matches the items of a list projected from elements by element, so a reorder shares every item that did not change', () => {
            const snapshotComparer = snapshotComparerOf('@element.children { key: attributeOf "key", n: attributeOf "n" }', { element });
            const [a, b, c] = [{ nodeType: 1 }, { nodeType: 1 }, { nodeType: 1 }];
            const identities = list => ({ elements: list, items: list.map(() => null) });
            const previous = freeze([{ key: 'a', n: '1' }, { key: 'b', n: '2' }, { key: 'c', n: '3' }]);
            const next = snapshotComparer.reconcile(previous, identities([a, b, c]), freeze([{ key: 'c', n: '3' }, { key: 'a', n: '9' }, { key: 'b', n: '2' }]), identities([c, a, b]));

            expect(next[0]).toBe(previous[2]);
            expect(next[2]).toBe(previous[1]);
            expect(next[1]).toEqual({ key: 'a', n: '9' });
            expect(next[1]).not.toBe(previous[0]);
        });

        it('compares the items of a shape over a list', () => {
            const snapshotComparer = snapshotComparerOf('@element.children { key: attributeOf "key" }', { element });
            const previous = freeze([{ key: 'a' }, null]);

            expect(snapshotComparer.reconcile(previous, null, freeze([{ key: 'a' }, null]), null)).toBe(previous);
        });
    });
});
