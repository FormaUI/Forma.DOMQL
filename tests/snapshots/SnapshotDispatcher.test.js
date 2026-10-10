import { beforeEach, describe, it, expect } from 'vitest';
import { SnapshotDispatcher } from '#domql/snapshots/SnapshotDispatcher.mjs';

const freeze = value => (Array.isArray(value)
    ? Object.freeze(value.map(freeze))
    : value !== null && typeof value === 'object' ? Object.freeze(Object.fromEntries(Object.entries(value).map(([name, field]) => [name, freeze(field)]))) : value);

describe('SnapshotDispatcher', () => {
    let delivered;
    let sender;

    beforeEach(() => {
        delivered = [];
        sender = new SnapshotDispatcher(delivery => delivered.push(delivery));
    });

    const dispatch = (snapshot, isDue = false) => sender.dispatch(freeze(snapshot), null, isDue);

    it('sends the first result as the baseline of the first generation', () => {
        dispatch({ count: 1 });

        expect(delivered).toEqual([{ kind: 'baseline', generation: 1, from: null, to: 0, snapshot: { count: 1 } }]);
        expect(Object.isFrozen(delivered[0])).toBe(true);
    });

    it('sends nothing while a delivery waits for acknowledgment, then one change set against the state it established', () => {
        dispatch({ count: 1, kind: 'list' });
        dispatch({ count: 2, kind: 'list' });
        dispatch({ count: 3, kind: 'grid' });

        expect(delivered).toHaveLength(1);

        sender.acknowledge(delivered[0]);

        expect(delivered[1]).toEqual({ kind: 'changeSet', generation: 1, from: 0, to: 1, patch: [{ op: 'replace', path: '/count', value: 3 }, { op: 'replace', path: '/kind', value: 'grid' }] });
    });

    it('sends nothing for changes that cancel out while a delivery waits', () => {
        dispatch({ count: 1 });
        dispatch({ count: 2 });
        dispatch({ count: 1 });
        sender.acknowledge(delivered[0]);

        expect(delivered).toHaveLength(1);
    });

    it('sends an empty change set where a delivery is due though nothing changed', () => {
        dispatch({ count: 1 });
        sender.acknowledge(delivered[0]);
        dispatch({ count: 1 }, true);

        expect(delivered[1]).toEqual({ kind: 'changeSet', generation: 1, from: 0, to: 1, patch: [] });
    });

    it('chains each change set to the revision the one before it reached', () => {
        dispatch({ count: 1 });
        sender.acknowledge(delivered[0]);
        dispatch({ count: 2 });
        sender.acknowledge(delivered[1]);
        dispatch({ count: 3 });

        expect(delivered.map(({ from, to }) => [from, to])).toEqual([[null, 0], [0, 1], [1, 2]]);
    });

    it('ignores an acknowledgment of a delivery that is not waiting, or one given twice', () => {
        dispatch({ count: 1 });
        sender.acknowledge({ ...delivered[0], to: 5 });
        dispatch({ count: 2 });

        expect(delivered).toHaveLength(1);

        sender.acknowledge(delivered[0]);
        sender.acknowledge(delivered[0]);

        expect(delivered).toHaveLength(2);
        expect(delivered[1].from).toBe(0);
    });

    it('takes an acknowledgment given while a delivery is handed over', () => {
        const synchronous = new SnapshotDispatcher(delivery => {
            delivered.push(delivery);
            synchronous.acknowledge(delivery);
        });

        synchronous.dispatch(freeze({ count: 1 }), null, false);
        synchronous.dispatch(freeze({ count: 2 }), null, false);
        synchronous.dispatch(freeze({ count: 3 }), null, false);

        expect(delivered.map(delivery => delivery.kind)).toEqual(['baseline', 'changeSet', 'changeSet']);
        expect(delivered[2].patch).toEqual([{ op: 'replace', path: '/count', value: 3 }]);
    });

    it('recovers with a baseline of a new generation, which no late delivery or acknowledgment of the old one can change', () => {
        dispatch({ count: 1 });
        sender.acknowledge(delivered[0]);
        dispatch({ count: 2 });

        const abandoned = delivered[1];

        dispatch({ count: 3 });
        sender.recover();

        expect(delivered[2]).toEqual({ kind: 'baseline', generation: 2, from: null, to: 0, snapshot: { count: 3 } });

        sender.acknowledge(abandoned);
        dispatch({ count: 4 });

        expect(delivered).toHaveLength(3);

        sender.acknowledge(delivered[2]);

        expect(delivered[3]).toEqual({ kind: 'changeSet', generation: 2, from: 0, to: 1, patch: [{ op: 'replace', path: '/count', value: 4 }] });
    });

    it('computes a change set by element for a list projected from elements', () => {
        const [a, b] = [{ nodeType: 1 }, { nodeType: 1 }];
        const identities = list => ({ fields: { rows: { elements: list, items: list.map(() => null) } } });

        sender.dispatch(freeze({ rows: [{ k: 'a' }, { k: 'b' }] }), identities([a, b]), false);
        sender.acknowledge(delivered[0]);
        sender.dispatch(freeze({ rows: [{ k: 'b' }, { k: 'a' }] }), identities([b, a]), false);

        expect(delivered[1].patch).toEqual([{ op: 'move', from: '/rows/1', path: '/rows/0' }]);
    });
});
