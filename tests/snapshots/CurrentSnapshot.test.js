import { describe, it, expect } from 'vitest';
import { CurrentSnapshot } from '#domql/snapshots/CurrentSnapshot.mjs';

const baseline = (generation, snapshot) => ({ kind: 'baseline', generation, from: null, to: 0, snapshot });
const changeSet = (generation, from, patch) => ({ kind: 'changeSet', generation, from, to: from + 1, patch });

describe('CurrentSnapshot', () => {
    it('starts with no state, and takes a baseline as its state, immutable and its own', () => {
        const current = new CurrentSnapshot();
        const sent = { count: 1, rows: [{ key: 'a' }] };

        expect(current.value).toBeNull();
        expect(current.apply(baseline(1, sent))).toBe('accepted');

        sent.rows.push({ key: 'b' });

        expect(current.value).toEqual({ count: 1, rows: [{ key: 'a' }] });
        expect(Object.isFrozen(current.value.rows[0])).toBe(true);
        expect([current.generation, current.revision]).toEqual([1, 0]);
    });

    it('applies each change set to the state it was computed against, revision by revision, leaving every snapshot it gave before as it was', () => {
        const current = new CurrentSnapshot();

        current.apply(baseline(1, { count: 1 }));

        const first = current.value;

        expect(current.apply(changeSet(1, 0, [{ op: 'replace', path: '/count', value: 2 }]))).toBe('accepted');
        expect(current.apply(changeSet(1, 1, [{ op: 'replace', path: '/count', value: 3 }]))).toBe('accepted');
        expect(current.value).toEqual({ count: 3 });
        expect(current.revision).toBe(2);
        expect(first).toEqual({ count: 1 });
    });

    it('gives an update the snapshot already passed no effect', () => {
        const current = new CurrentSnapshot();

        current.apply(baseline(1, { count: 1 }));
        current.apply(changeSet(1, 0, [{ op: 'replace', path: '/count', value: 2 }]));
        current.apply(baseline(2, { count: 5 }));

        expect(current.apply(changeSet(1, 1, [{ op: 'replace', path: '/count', value: 9 }]))).toBe('stale');
        expect(current.apply(baseline(1, { count: 9 }))).toBe('stale');
        expect(current.apply(baseline(2, { count: 9 }))).toBe('stale');

        current.apply(changeSet(2, 0, [{ op: 'replace', path: '/count', value: 6 }]));

        expect(current.apply(changeSet(2, 0, [{ op: 'replace', path: '/count', value: 9 }]))).toBe('stale');
        expect(current.value).toEqual({ count: 6 });
    });

    it('fails a change set whose state it does not have, leaving its own as it was', () => {
        const current = new CurrentSnapshot();

        expect(current.apply(changeSet(1, 0, [{ op: 'replace', path: '/count', value: 2 }]))).toBe('failed');

        current.apply(baseline(1, { count: 1 }));

        expect(current.apply(changeSet(1, 1, [{ op: 'replace', path: '/count', value: 3 }]))).toBe('failed');
        expect(current.apply(changeSet(2, 0, [{ op: 'replace', path: '/count', value: 3 }]))).toBe('failed');
        expect(current.value).toEqual({ count: 1 });
        expect(current.revision).toBe(0);
    });

    it('fails a change set that does not apply, whole: no operation of it reaches the state', () => {
        const current = new CurrentSnapshot();

        current.apply(baseline(1, { count: 1, rows: [{ key: 'a' }] }));

        const before = current.value;

        expect(current.apply(changeSet(1, 0, [{ op: 'replace', path: '/count', value: 2 }, { op: 'remove', path: '/rows/4' }]))).toBe('failed');
        expect(current.value).toBe(before);
        expect(current.revision).toBe(0);
    });

    it('fails an update that is not one', () => {
        const current = new CurrentSnapshot();

        current.apply(baseline(1, { count: 1 }));

        for (const update of [
            null,
            {},
            { kind: 'changeSet', generation: 1, from: 0, to: 2, patch: [] },
            { kind: 'changeSet', generation: 1, from: 0, to: 1, patch: 'none' },
            { kind: 'baseline', generation: 2, from: null, to: 0 },
            { kind: 'baseline', generation: 2, from: 0, to: 1, snapshot: { count: 9 } },
            { kind: 'baseline', generation: 'next', from: null, to: 0, snapshot: { count: 9 } },
        ]) {
            expect(current.apply(update)).toBe('failed');
        }

        expect(current.value).toEqual({ count: 1 });
    });
});
