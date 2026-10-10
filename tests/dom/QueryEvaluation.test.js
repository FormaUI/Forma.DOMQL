import { describe, it, expect } from 'vitest';
import { QueryEvaluation } from '#domql/dom/QueryEvaluation.mjs';

describe('QueryEvaluation', () => {
    /** A session that counts its disposals, and fails them where it is told to. */
    const session = failure => {
        const held = { disposed: 0 };

        held.dispose = () => {
            held.disposed++;

            if (failure !== undefined) {
                throw failure;
            }
        };

        return held;
    };

    const evaluationOf = sessions => new QueryEvaluation({ value: 1, isPending: false, dependencies: [], sessions, error: null });

    it('disposes every session once, however often it is disposed', () => {
        const sessions = [session(), session()];
        const evaluation = evaluationOf(sessions);

        evaluation.dispose();
        evaluation.dispose();

        expect(sessions.map(held => held.disposed)).toEqual([1, 1]);
        expect(evaluation.isDisposed).toBe(true);
    });

    it('disposes every session where one fails to be disposed, and then throws the first failure', () => {
        const first = new Error('first');
        const sessions = [session(first), session(new Error('second')), session()];
        const evaluation = evaluationOf(sessions);

        expect(() => evaluation.dispose()).toThrow(first);
        expect(sessions.map(held => held.disposed)).toEqual([1, 1, 1]);
        expect(() => evaluation.dispose()).not.toThrow();
    });
});
