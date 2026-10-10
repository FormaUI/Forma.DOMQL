/**
 * Watch — keeps a query's result current, evaluating again when something it depends on changes and reporting a snapshot that differs
 */

import { SnapshotDispatcher } from '../snapshots/SnapshotDispatcher.mjs';
import { DomqlError } from '../language/DomqlError.mjs';

export class Watch {
    #evaluator;
    #observations;
    #comparer;
    #window;
    #schedule;
    #onChange;
    #onError;
    #reportError;

    /** `pending` until the first snapshot is available, `ready` while the watch has a current one, `failed` after an evaluation fails, and `disposed` once it is ended. @type {'pending' | 'ready' | 'failed' | 'disposed'} */
    #status = 'pending';
    #lastSnapshot = null;
    #lastIdentities = null;
    #hasSnapshot = false;

    /** Whether the next successful evaluation reports its snapshot whether or not it differs, as after a failure. */
    #needsDelivery = false;

    /** The last evaluation that did not fail, and the latest one that did since: the watch holds the sessions of both. @type {import('./QueryEvaluation.mjs').QueryEvaluation | null} */
    #successfulEvaluation = null;

    /** @type {import('./QueryEvaluation.mjs').QueryEvaluation | null} */
    #failedEvaluation = null;

    /** The animation frame the next evaluation waits for. */
    #frame = null;
    #isRunning = false;

    /** Whether an evaluation has run, so the first one scheduled at creation is not repeated by a refresh that came before it. */
    #hasRun = false;

    /** What an evaluation asked for while another was running: nothing, an evaluation at the schedule, or one now. @type {'none' | 'schedule' | 'now'} */
    #rerun = 'none';

    /** The refreshes waiting for the next evaluation to complete. @type {{ resolve: () => void, reject: (error: unknown) => void }[]} */
    #pendingRefreshes = [];

    /** What delivers the snapshots as a baseline and then change sets, or null for a watch that delivers each snapshot whole. @type {SnapshotDispatcher | null} */
    #snapshotDispatcher = null;

    /**
     * @param {object} configuration What the watch keeps current and how.
     * @param {import('./QueryEvaluator.mjs').QueryEvaluator} configuration.evaluator Evaluates the query.
     * @param {import('./Observations.mjs').Observations} configuration.observations The observations of the window, which the watch holds sessions on.
     * @param {import('../snapshots/SnapshotComparer.mjs').SnapshotComparer} configuration.comparer Compares the snapshots.
     * @param {Window} configuration.window The window the watch belongs to.
     * @param {(error: unknown) => void} configuration.reportError The diagnostic reporting boundary, which a failure of `onError` reaches and an error reaches where there is no `onError`.
     * @param {object} configuration.options What the caller chose.
     * @param {'frame' | 'immediate'} configuration.options.schedule When an evaluation follows a change: at the next animation frame, once however many observations fired, or in the task that reported it.
     * @param {'snapshot' | 'changeSet'} configuration.options.updateStrategy How the watch updates its caller, and so what `onChange` receives: each snapshot whole, or a baseline and then the change sets between snapshots, each acknowledged before the next.
     * @param {(update: unknown) => unknown} configuration.options.onChange Receives each snapshot, or, where the watch delivers change sets, each baseline and change set, the first as the baseline. What it returns is not awaited.
     * @param {((error: unknown) => unknown) | undefined} configuration.options.onError Receives a failure of an evaluation and of `onChange`; by default they go to the diagnostic reporting boundary.
     */
    constructor({ evaluator, observations, comparer, window, reportError, options: { schedule, updateStrategy = 'snapshot', onChange, onError } }) {
        this.#evaluator = evaluator;
        this.#observations = observations;
        this.#comparer = comparer;
        this.#window = window;
        this.#schedule = schedule;
        this.#onChange = onChange;
        this.#onError = onError;
        this.#reportError = error => {
            try {
                reportError(error);
            } catch {
                // Nothing is left to report to.
            }
        };

        if (updateStrategy === 'changeSet') {
            this.#snapshotDispatcher = new SnapshotDispatcher(update => this.#deliver(update));
        }

        // The first evaluation follows the caller receiving the handle, so no callback runs before it has one.
        queueMicrotask(() => {
            if (!this.#hasRun) {
                this.#run();
            }
        });
    }

    /** `pending` until the first snapshot is available, `ready` while the watch has a current one, `failed` after an evaluation fails, and `disposed` once it is ended. */
    get status() {
        return this.#status;
    }

    /** The snapshot last reported, null before the first, and null where the snapshot itself is null. */
    get lastSnapshot() {
        return this.#lastSnapshot;
    }

    /**
     * Evaluates now instead of at the schedule, and settles once the evaluation has completed and the snapshot it produced, if it differs, has been handed to the callback.
     * It rejects with the failure of its evaluation, resolves without delivering where disposal cancels it, and rejects where called after disposal.
     */
    refreshAsync() {
        if (this.#status === 'disposed') {
            return Promise.reject(DomqlError.evaluation('A disposed watch cannot be refreshed', {}));
        }

        return new Promise((resolve, reject) => {
            this.#pendingRefreshes.push({ resolve, reject });

            if (this.#isRunning) {
                this.#rerun = 'now';
            } else {
                this.#run();
            }
        });
    }

    /**
     * Confirms that the receiver applied a delivery of a watch that delivers change sets, so the next change set is computed against the state it established.
     * A delivery that recovery abandoned, or one confirmed already, changes nothing; acceptance is the host's to report, and a callback that fails after the receiver applied a delivery does not undo it.
     * @param {object} update The update the current snapshot applied.
     */
    acknowledge(update) {
        this.#requireChangeSets('acknowledged').acknowledge(update);
    }

    /** Abandons the deliveries of the current generation, the one waiting for acknowledgment included, and sends the current snapshot as a new baseline that nothing from before can change, for a receiver whose state cannot be trusted. */
    recover() {
        this.#requireChangeSets('recovered').recover();
    }

    #requireChangeSets(verb) {
        if (this.#snapshotDispatcher === null) {
            throw DomqlError.structure(`A watch that delivers snapshots is not ${verb}; a watch that delivers change sets is`, {});
        }

        return this.#snapshotDispatcher;
    }

    /** Ends the watch: cancels the evaluation it scheduled, disposes every session and prevents any new callback invocation; a callback already running may finish. Disposing again does nothing. */
    dispose() {
        if (this.#status === 'disposed') {
            return;
        }

        this.#status = 'disposed';
        this.#cancelFrame();

        this.#successfulEvaluation?.dispose();
        this.#failedEvaluation?.dispose();
        this.#successfulEvaluation = null;
        this.#failedEvaluation = null;

        for (const { resolve } of this.#pendingRefreshes.splice(0)) {
            resolve();
        }
    }

    /** Asks for an evaluation at the schedule, which a change to something the result depends on does. */
    #invalidate() {
        if (this.#status === 'disposed') {
            return;
        }

        if (this.#isRunning) {
            if (this.#rerun === 'none') {
                this.#rerun = 'schedule';
            }

            return;
        }

        if (this.#schedule === 'immediate') {
            this.#run();
        } else if (this.#frame === null) {
            this.#frame = this.#window.requestAnimationFrame(() => {
                this.#frame = null;
                this.#run();
            });
        }
    }

    #cancelFrame() {
        if (this.#frame !== null) {
            this.#window.cancelAnimationFrame(this.#frame);
            this.#frame = null;
        }
    }

    #run() {
        if (this.#status === 'disposed') {
            return;
        }

        this.#hasRun = true;
        this.#cancelFrame();

        // The refreshes waiting now are answered by this evaluation, and one asked for while it runs by the next.
        const waiting = this.#pendingRefreshes.splice(0);

        this.#isRunning = true;

        try {
            this.#settle(this.#evaluator.evaluate({ observations: this.#observations, onChange: () => this.#invalidate(), holdsAll: true }), waiting);
        } finally {
            this.#isRunning = false;
        }

        const rerun = this.#rerun;

        this.#rerun = 'none';

        if (rerun === 'now') {
            this.#run();
        } else if (rerun === 'schedule') {
            this.#invalidate();
        }
    }

    #settle(queryEvaluation, waiting) {
        if (this.#status === 'disposed') {
            queryEvaluation.dispose();

            for (const { resolve } of waiting) {
                resolve();
            }

            return;
        }

        if (queryEvaluation.error !== null) {
            // The watch keeps the dependencies of its last successful evaluation together with those the failed one recorded.
            this.#failedEvaluation?.dispose();
            this.#failedEvaluation = queryEvaluation;
            this.#status = 'failed';
            this.#needsDelivery = true;
            this.#fail(queryEvaluation.error);

            for (const { reject } of waiting) {
                reject(queryEvaluation.error);
            }

            return;
        }

        this.#replace(queryEvaluation);

        // The first snapshot waits for the first sample of every maintained member it reads, and an evaluation that produced none waits for the sample it failed on.
        if (queryEvaluation.value === undefined || (queryEvaluation.isPending && !this.#hasSnapshot)) {
            this.#pendingRefreshes.unshift(...waiting);

            return;
        }

        const next = this.#hasSnapshot ? this.#comparer.reconcile(this.#lastSnapshot, this.#lastIdentities, queryEvaluation.value, queryEvaluation.identities) : queryEvaluation.value;
        const isDue = this.#needsDelivery;
        const isReported = !this.#hasSnapshot || isDue || next !== this.#lastSnapshot;

        this.#lastSnapshot = next;
        this.#lastIdentities = queryEvaluation.identities;
        this.#hasSnapshot = true;
        this.#needsDelivery = false;
        this.#status = 'ready';

        if (isReported && this.#snapshotDispatcher !== null) {
            this.#snapshotDispatcher.dispatch(next, queryEvaluation.identities, isDue);
        } else if (isReported) {
            this.#deliver(next);
        }

        for (const { resolve } of waiting) {
            resolve();
        }
    }

    /** Holds the evaluation's sessions and lets go of the ones the evaluations before it held, after it has its own, so an observation both need keeps running. */
    #replace(queryEvaluation) {
        const before = [this.#successfulEvaluation, this.#failedEvaluation];

        this.#successfulEvaluation = queryEvaluation;
        this.#failedEvaluation = null;

        for (const old of before) {
            old?.dispose();
        }
    }

    #deliver(update) {
        if (this.#status === 'disposed') {
            return;
        }

        try {
            Watch.#observe(this.#onChange(update), error => this.#fail(error));
        } catch (error) {
            this.#fail(error);
        }
    }

    /** Reports a failure to the error callback, whose own failure goes to the diagnostic boundary and calls nothing again. */
    #fail(error) {
        if (this.#onError === undefined || this.#status === 'disposed') {
            this.#reportError(error);

            return;
        }

        try {
            Watch.#observe(this.#onError(error), failure => this.#reportError(failure));
        } catch (failure) {
            this.#reportError(failure);
        }
    }

    /** Hands the rejection of a promise a callback returned to `report`, without waiting for it. */
    static #observe(result, report) {
        if (typeof result?.then === 'function') {
            result.then(undefined, report);
        }
    }
}
