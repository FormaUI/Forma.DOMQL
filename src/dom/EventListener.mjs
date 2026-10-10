/**
 * EventListener — owns an occurrence subscription, projects each occurrence,
 * and retains its observation sessions until replaced or disposed.
 */

import { DomqlError } from '../language/DomqlError.mjs';
import { CallbackDispatcher } from './CallbackDispatcher.mjs';

export class EventListener {
    #evaluator;
    #observations;
    #callbackDispatcher;

    /** What stops the source, once it has started. @type {{ stop: () => void } | null} */
    #subscription = null;

    /** `ready` while the event listener listens, and `disposed` once it is ended. @type {'ready' | 'disposed'} */
    #status = 'ready';

    /** The last projection that succeeded, whose sessions keep the observations it read, so the next occurrence reads what they sampled meanwhile. @type {import('./QueryEvaluation.mjs').QueryEvaluation | null} */
    #lastProjection = null;

    /** The callbacks waiting until the caller has the event listener, in the order their occurrences arrived, or null once callbacks run as their occurrences do. @type {(() => void)[] | null} */
    #heldCallbacks = [];

    /**
     * Starts listening, so an occurrence delivered once the constructor returns is heard; a source that cannot start fails it.
     * A source may deliver while it starts: those occurrences are captured and projected at once, and their callbacks run once the caller has the event listener, before those of any later occurrence.
     * @param {object} configuration What the event listener listens to and how.
     * @param {import('./QueryEvaluator.mjs').QueryEvaluator} configuration.evaluator Evaluates the subscription.
     * @param {import('./Observations.mjs').Observations} configuration.observations The observations of the window, which the projections hold sessions on.
     * @param {(error: unknown) => void} configuration.reportError The diagnostic reporting boundary, which a failure of `onError` reaches and an error reaches where there is no `onError`.
     * @param {object} configuration.options What the caller chose.
     * @param {(result: unknown) => unknown} configuration.options.onEvent Receives the result of each event's projection. What it returns is not awaited.
     * @param {((error: unknown) => unknown) | undefined} configuration.options.onError Receives a failure of a capture, of a projection and of `onEvent`; by default they go to the diagnostic reporting boundary.
     */
    constructor({ evaluator, observations, reportError, options: { onEvent, onError } }) {
        this.#evaluator = evaluator;
        this.#observations = observations;
        this.#callbackDispatcher = new CallbackDispatcher({ onUpdate: onEvent, onError, reportError, isDisposed: () => this.#status === 'disposed' });

        try {
            this.#subscription = this.#start(evaluator.resolveSource());
        } catch (error) {
            // A failed start ends the event listener: it lets go of what the occurrences delivered while it started opened, drops their callbacks, and ignores what the source still delivers.
            this.#status = 'disposed';
            this.#heldCallbacks = null;
            this.#release(this.#lastProjection);
            this.#lastProjection = null;

            throw error;
        }

        if (this.#heldCallbacks.length === 0) {
            this.#heldCallbacks = null;
        } else {
            queueMicrotask(() => this.#runHeldCallbacks());
        }
    }

    /** `ready` while the event listener listens, and `disposed` once it is ended. */
    get status() {
        return this.#status;
    }

    /** Ends the event listener: stops listening, disposes every session and prevents any new callback invocation; a callback already running may finish. Disposing again does nothing. */
    dispose() {
        if (this.#status === 'disposed') {
            return;
        }

        this.#status = 'disposed';

        try {
            this.#subscription?.stop();
        } catch (error) {
            this.#callbackDispatcher.reportError(error);
        }

        this.#release(this.#lastProjection);
        this.#lastProjection = null;
    }

    /** Starts the source and answers what stops it; a source whose receiver or an argument is null has nothing to listen to. */
    #start(source) {
        if (source === null) {
            return { stop: () => {} };
        }

        const { name, start, capture, receiver, args, environment, location } = source;

        // The source captures each occurrence as the fields its type declares, during its delivery, before anything else reads it.
        const deliver = occurrence => {
            if (this.#status === 'disposed') {
                return;
            }

            let captured;

            try {
                captured = capture(occurrence);
            } catch (error) {
                this.#notify(() => this.#callbackDispatcher.handleError(error));

                return;
            }

            this.#onOccurrence(captured);
        };

        let subscription;

        try {
            subscription = start(receiver, args, environment, deliver);
        } catch (error) {
            throw DomqlError.evaluation(`The source '${name}' failed to start listening`, location, { cause: error });
        }

        if (typeof subscription?.stop !== 'function') {
            throw DomqlError.evaluation(`The source '${name}' started listening and answered nothing that stops it`, location);
        }

        return subscription;
    }

    /**
     * Projects the captured occurrence synchronously during source delivery, then dispatches its immutable result.
     * A successful projection replaces the sessions the event listener retains; one that fails dispatches its error instead, lets go of the sessions it opened and keeps those retained before it.
     */
    #onOccurrence(occurrence) {
        const projection = this.#evaluator.project(occurrence, { observations: this.#observations });

        if (projection.error !== null) {
            this.#release(projection);
            this.#notify(() => this.#callbackDispatcher.handleError(projection.error));

            return;
        }

        // The projection holds its sessions before the last lets go of its own, so an observation both read keeps running.
        const last = this.#lastProjection;

        this.#lastProjection = projection;
        this.#release(last);
        this.#notify(() => this.#callbackDispatcher.dispatch(projection.value));
    }

    /** Runs the callback now, or after those held before it while the caller does not have the event listener yet. */
    #notify(callback) {
        if (this.#heldCallbacks === null) {
            callback();
        } else {
            this.#heldCallbacks.push(callback);
        }
    }

    /** Runs the held callbacks in order, including any their own callbacks cause, and then lets callbacks run as their occurrences do. */
    #runHeldCallbacks() {
        const held = this.#heldCallbacks;

        for (let index = 0; index < held.length; index++) {
            held[index]();
        }

        this.#heldCallbacks = null;
    }

    /** Disposes a projection's sessions, reporting a failure to, so it keeps nothing else from happening. */
    #release(projection) {
        try {
            projection?.dispose();
        } catch (error) {
            this.#callbackDispatcher.reportError(error);
        }
    }
}
