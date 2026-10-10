/**
 * QueryEvaluation — one evaluation of a query: its result, what the result depends on, and the sessions that keep those dependencies observed
 */

/**
 * What one call of a member depended on: the member, where it stands in the query, and the observations that cover its changes, each resolved against the call.
 * @typedef {{ member: string, pointer: string, observations: { type: string, target: object, arguments: Record<string, any> }[] }} Dependency
 */

export class QueryEvaluation {
    #sessions;
    #isDisposed = false;

    /**
     * @param {object} outcome What the evaluation produced.
     * @param {unknown} outcome.value The detached result, in which a member still waiting for its first sample answers null, or undefined where the evaluation produced none.
     * @param {import('../snapshots/SnapshotPatcher.mjs').Identities} outcome.identities The elements the result's lists were projected from.
     * @param {boolean} outcome.isPending Whether a maintained member the result reads is still waiting for its first sample.
     * @param {Dependency[]} outcome.dependencies What the evaluation read, including what it read before it failed.
     * @param {import('./ObservationSession.mjs').ObservationSession[]} outcome.sessions The sessions that hold the dependencies' observations.
     * @param {Error | null} outcome.error The failure that ended the evaluation, or null.
     */
    constructor({ value, identities = null, isPending, dependencies, sessions, error }) {
        this.value = value;
        this.identities = identities;
        this.isPending = isPending;
        this.dependencies = Object.freeze(dependencies);
        this.error = error;
        this.#sessions = sessions;
    }

    /** Whether the evaluation has let go of its observations. */
    get isDisposed() {
        return this.#isDisposed;
    }

    /**
     * Disposes every session the evaluation holds, so the observations only it needed stop. Disposing again does nothing.
     * Every session is disposed even where one fails to be, and the first failure is thrown once all of them have been.
     */
    dispose() {
        if (this.#isDisposed) {
            return;
        }

        this.#isDisposed = true;

        let failure = null;

        for (const session of this.#sessions) {
            try {
                session.dispose();
            } catch (error) {
                failure ??= { error };
            }
        }

        if (failure !== null) {
            throw failure.error;
        }
    }
}
