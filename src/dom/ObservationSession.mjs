/**
 * ObservationSession — one consumer's access to a shared observation.
 * Disposing the session ends that access; the last session stops the observation.
 */

export class ObservationSession {
    #contract;
    #observation;
    #onChange;
    #end;
    #reportError;
    #isDisposed = false;

    /**
     * @param {object} access What the session gives access to.
     * @param {'invalidation' | 'maintained'} access.contract What the observation provides.
     * @param {{ sample?: () => { pending: boolean, value: unknown } } | null} access.observation The observation, or null where nothing is observed.
     * @param {() => void} access.onChange Called, synchronously, when something may have changed; what it returns is ignored, so a promise it returns is not awaited and a rejection of it is not caught.
     * @param {(session: ObservationSession) => void} access.end Lets the observations know this consumer has ended its access.
     * @param {(error: unknown) => void} access.reportError Where a failure of onChange is reported, which does not throw.
     */
    constructor({ contract, observation, onChange, end, reportError }) {
        this.#contract = contract;
        this.#observation = observation;
        this.#onChange = onChange;
        this.#end = end;
        this.#reportError = reportError;
    }

    /** A session on nothing, for a request that observes nothing. */
    static none() {
        return new ObservationSession({ contract: 'invalidation', observation: null, onChange: () => {}, end: () => {}, reportError: () => {} });
    }

    /** What the observation provides: a signal that a result may have changed, or a sample a member reads. */
    get contract() {
        return this.#contract;
    }

    /** Whether this consumer has ended its access. */
    get isDisposed() {
        return this.#isDisposed;
    }

    /** The observation's latest sample, pending until its first arrives; only a maintained observation has one, and a disposed session has none, since the observation may have stopped. */
    sample() {
        if (this.#isDisposed) {
            throw new TypeError('A disposed session has no sample');
        }

        if (this.#contract !== 'maintained') {
            throw new TypeError('Only a maintained observation has a sample');
        }

        return this.#observation.sample();
    }

    /** Tells the consumer something may have changed, unless it has disposed the session; a failure of its callback is reported and reaches no other consumer. */
    notify() {
        if (this.#isDisposed) {
            return;
        }

        try {
            this.#onChange();
        } catch (error) {
            this.#reportError(error);
        }
    }

    /** Ends this consumer's access; the observation ends with its last session. Disposing again does nothing. */
    dispose() {
        if (this.#isDisposed) {
            return;
        }

        this.#isDisposed = true;
        this.#end(this);
    }
}
