/**
 * LiveState — one object a watch keeps current in place: it keeps its identity, and so does every object and list beneath it while its path holds one
 */

import { SnapshotPatcher } from './SnapshotPatcher.mjs';

export class LiveState {
    /** The object the caller holds, or null before the first snapshot. @type {object | unknown[] | null} */
    #state = null;

    /** The snapshot the state was last brought to, and the elements its lists were projected from, against which the next change set is computed. */
    #snapshot = null;
    #identities = null;

    /** The object the caller holds, the same from the first snapshot on, or null before it. */
    get state() {
        return this.#state;
    }

    /**
     * Brings the state to the snapshot, in place, and returns the change set that did, frozen. The first snapshot builds the state, and returns no changes.
     * @param {object | unknown[]} snapshot The result, a shape or a list.
     * @param {import('./SnapshotPatcher.mjs').Identities} identities The elements its lists were projected from.
     * @returns {readonly import('./SnapshotPatcher.mjs').ChangeOperation[]}
     */
    update(snapshot, identities) {
        let changes = [];

        if (this.#state === null) {
            this.#state = Array.isArray(snapshot) ? [] : {};
            SnapshotPatcher.applyInPlace(this.#state, [{ op: 'replace', path: '', value: snapshot }]);
        } else {
            changes = SnapshotPatcher.between(this.#snapshot, this.#identities, snapshot, identities);
            SnapshotPatcher.applyInPlace(this.#state, changes);
        }

        this.#snapshot = snapshot;
        this.#identities = identities;

        return Object.freeze(changes.map(operation => Object.freeze(operation)));
    }
}
