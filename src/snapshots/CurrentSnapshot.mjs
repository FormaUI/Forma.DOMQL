/**
 * CurrentSnapshot — the snapshot a watch's updates build, applying each one atomically to the state it was computed against and giving a stale one no effect
 */

import { SnapshotPatcher } from './SnapshotPatcher.mjs';

export class CurrentSnapshot {
    #value = null;
    #generation = null;
    #revision = null;

    /** The snapshot last accepted, immutable; null before the first baseline. Applying an update advances the current snapshot and leaves every snapshot it gave before unchanged. */
    get value() {
        return this.#value;
    }

    /** The generation of the baseline the state started from, or null before the first. */
    get generation() {
        return this.#generation;
    }

    /** The revision of the state within its generation, or null before the first baseline. */
    get revision() {
        return this.#revision;
    }

    /**
     * Applies an update, a baseline or a change set, answering what became of it:
     * `accepted` where it applied, which the host tells the watch by acknowledging it;
     * `stale` where it belongs to an older generation or a revision the snapshot passed, which changes nothing and needs nothing;
     * `failed` where it cannot apply, a change set computed against a snapshot this one is not or one that does not apply to it, which leaves the snapshot as it was and asks the host to recover the watch.
     * @param {import('./SnapshotDispatcher.mjs').SnapshotUpdate} update The update a watch delivered.
     * @returns {'accepted' | 'stale' | 'failed'}
     */
    apply(update) {
        if (update?.kind === 'baseline') {
            // A baseline starts its generation at revision 0 and carries the whole snapshot, without which there is nothing to build on.
            if (!Number.isInteger(update.generation) || update.from !== null || update.to !== 0 || !Object.hasOwn(update, 'snapshot')) {
                return 'failed';
            }

            if (this.#generation !== null && update.generation <= this.#generation) {
                return 'stale';
            }

            this.#value = SnapshotPatcher.apply(null, [{ op: 'replace', path: '', value: update.snapshot }]);
            this.#generation = update.generation;
            this.#revision = 0;

            return 'accepted';
        }

        if (update?.kind !== 'changeSet' || !Number.isInteger(update.generation) || !Number.isInteger(update.from) || update.to !== update.from + 1) {
            return 'failed';
        }

        if (this.#generation !== null && (update.generation < this.#generation || (update.generation === this.#generation && update.to <= this.#revision))) {
            return 'stale';
        }

        if (update.generation !== this.#generation || update.from !== this.#revision) {
            return 'failed';
        }

        let value;

        try {
            value = SnapshotPatcher.apply(this.#value, update.patch);
        } catch {
            return 'failed';
        }

        this.#value = value;
        this.#revision = update.to;

        return 'accepted';
    }
}
