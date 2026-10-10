/**
 * CallbackDispatcher — dispatches each update to its owner's callback and each error to its error handler, so a failure of either never interrupts the owner
 */

export class CallbackDispatcher {
    #onUpdate;
    #onError;
    #reportError;
    #isDisposed;

    /**
     * @param {object} callbacks The callbacks, and the lifecycle of their owner.
     * @param {(value: unknown) => unknown} callbacks.onUpdate
     * Receives each update. Returned promises are not awaited;
     * their rejections are passed to onError.
     * @param {((error: unknown) => unknown)} [callbacks.onError]
     * Handles evaluation and onUpdate errors. If omitted, errors go
     * directly to reportError.
     * @param {(error: unknown) => void} callbacks.reportError
     * Reports errors when onError is absent, fails, or cannot be called
     * because the owner is disposed. Must be synchronous.
     * Exceptions thrown by this reporter are swallowed.
     * @param {() => boolean} callbacks.isDisposed
     * Whether the owner is disposed. Once disposed, neither onUpdate
     * nor onError is invoked.
     */
    constructor({ onUpdate, onError, reportError, isDisposed }) {
        this.#onUpdate = onUpdate;
        this.#onError = onError;
        this.#isDisposed = isDisposed;

        this.#reportError = error => {
            try {
                reportError(error);
            } catch {
                // Keep a reporter failure from interrupting the caller.
            }
        };
    }

    /** Dispatches the update to onUpdate, unless the owner is disposed; an error onUpdate throws, or a rejection of the promise it returns, goes to `handleError`. */
    dispatch(update) {
        if (this.#isDisposed()) {
            return;
        }

        try {
            CallbackDispatcher.#observe(this.#onUpdate(update), error => this.handleError(error));
        } catch (error) {
            this.handleError(error);
        }
    }

    /** Passes the error to onError, or to reportError where onError is absent or the owner is disposed; an error of onError itself goes to reportError and calls nothing again. */
    handleError(error) {
        if (this.#onError === undefined || this.#isDisposed()) {
            this.#reportError(error);

            return;
        }

        try {
            CallbackDispatcher.#observe(this.#onError(error), failure => this.#reportError(failure));
        } catch (failure) {
            this.#reportError(failure);
        }
    }

    /** Reports the error straight to reportError, for an error no callback is told of. */
    reportError(error) {
        this.#reportError(error);
    }

    /** Hands the rejection of a promise a callback returned to `report`, without waiting for it. */
    static #observe(result, report) {
        if (typeof result?.then === 'function') {
            result.then(undefined, report);
        }
    }
}
