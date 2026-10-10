/**
 * SnapshotDispatcher — delivers a watch's results as a baseline and then change sets, one at a time, each acknowledged before the next is computed against the state it established
 */

import { SnapshotPatcher } from './SnapshotPatcher.mjs';

/**
 * An update of a snapshot, whatever carries it: a baseline, the complete result that starts a generation at revision 0, or a change set from one revision of the generation to the next.
 * @typedef {{ kind: 'baseline', generation: number, from: null, to: 0, snapshot: unknown } | { kind: 'changeSet', generation: number, from: number, to: number, patch: import('./SnapshotPatcher.mjs').ChangeOperation[] }} SnapshotUpdate
 */

export class SnapshotDispatcher {
    #deliver;

    /** The generation of the last baseline sent, and the revision the last update sent reaches. */
    #generation = 0;
    #revision = 0;

    /** The state the current snapshot confirmed, with the identities of its lists; null before a baseline is acknowledged, and after recovery. */
    #accepted = null;

    /** The update waiting for acknowledgment, with the state it establishes. */
    #inFlight = null;

    /** The latest result to deliver, with the identities of its lists. */
    #desired = null;

    /** Whether the next update is due even where the result did not change, as after a failed evaluation. */
    #isDue = false;

    /** @param {(update: SnapshotUpdate) => void} deliver Hands an update to the caller. */
    constructor(deliver) {
        this.#deliver = deliver;
    }

    /**
     * Takes the latest result, which is delivered once nothing is waiting for acknowledgment: as a baseline before the current snapshot has one, and otherwise as a change set against the state it has.
     * @param {unknown} snapshot The result.
     * @param {import('./SnapshotPatcher.mjs').Identities} identities The elements its lists were projected from.
     * @param {boolean} isDue Whether it is delivered even where it equals the state the current snapshot has.
     */
    dispatch(snapshot, identities, isDue) {
        this.#desired = { snapshot, identities };
        this.#isDue ||= isDue;
        this.#flush();
    }

    /**
     * Confirms that the current snapshot applied the update, which makes the state it establishes the one the next change set is computed against.
     * An update of a generation recovery abandoned, or one already confirmed, changes nothing.
     * @param {SnapshotUpdate} update The update the current snapshot applied.
     */
    acknowledge(update) {
        const waiting = this.#inFlight;

        if (waiting === null || update?.generation !== waiting.update.generation || update.to !== waiting.update.to) {
            return;
        }

        this.#accepted = { snapshot: waiting.snapshot, identities: waiting.identities };
        this.#inFlight = null;
        this.#flush();
    }

    /** Abandons the generation, the update waiting in it included, and sends the latest result as the baseline of a new one, which nothing from before can change. */
    recover() {
        this.#accepted = null;
        this.#inFlight = null;
        this.#flush();
    }

    #flush() {
        if (this.#inFlight !== null || this.#desired === null) {
            return;
        }

        const { snapshot, identities } = this.#desired;
        let update;

        if (this.#accepted === null) {
            this.#generation++;
            this.#revision = 0;
            update = Object.freeze({ kind: 'baseline', generation: this.#generation, from: null, to: 0, snapshot });
        } else {
            const patch = SnapshotPatcher.between(this.#accepted.snapshot, this.#accepted.identities, snapshot, identities);

            // Changes that cancel out send nothing, unless an update is due.
            if (patch.length === 0 && !this.#isDue) {
                return;
            }

            update = Object.freeze({ kind: 'changeSet', generation: this.#generation, from: this.#revision, to: this.#revision + 1, patch: Object.freeze(patch.map(operation => Object.freeze(operation))) });
            this.#revision++;
        }

        this.#isDue = false;

        // The update is waiting before it is handed over, so an acknowledgment given while it is handed over is taken.
        this.#inFlight = { update, snapshot, identities };
        this.#deliver(update);
    }
}
