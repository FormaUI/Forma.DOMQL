/**
 * SnapshotComparer — compares the snapshots of a query's result, so a watch reports one that differs and shares what did not change
 */

import { Names } from '../language/Names.mjs';

export class SnapshotComparer {
    #resolvedDefinition;

    /** @param {import('../language/ResolvedDefinition.mjs').ResolvedDefinition} resolvedDefinition The resolved definition whose snapshots are compared. */
    constructor(resolvedDefinition) {
        this.#resolvedDefinition = resolvedDefinition;
    }

    /**
     * The next snapshot, in which every branch equal to the previous snapshot's is the previous branch itself, so a snapshot that did not change is the previous one and a new snapshot shares what it did not change.
     * Strings, Booleans and null compare exactly, and a number compares within the tolerance the member that produced it declares, and exactly where it declares none.
     * @param {unknown} previous The snapshot last reported.
     * @param {unknown} next The snapshot to compare, which is frozen.
     */
    reconcile(previous, next) {
        return this.#reconcileNode(this.#resolvedDefinition.definition.query, '/query', previous, next);
    }

    #reconcileNode(node, pointer, previous, next) {
        if (node.kind !== 'shape' || next === null || typeof next !== 'object') {
            return SnapshotComparer.#merge(previous, next, this.#toleranceOf(node, pointer));
        }

        if (!Array.isArray(next)) {
            return this.#reconcileFields(node, pointer, previous, next);
        }

        // A shape that follows a list projects each of its items.
        const items = next.map((item, index) => (item === null ? null : this.#reconcileFields(node, pointer, Array.isArray(previous) ? previous[index] : undefined, item)));

        return SnapshotComparer.#sameItems(previous, items) ? previous : Object.freeze(items);
    }

    #reconcileFields(node, pointer, previous, next) {
        const before = SnapshotComparer.#isRecord(previous) ? previous : undefined;
        const fields = {};

        node.fields.forEach((field, index) => {
            const name = field.name ?? Names.inferField(field.value);

            fields[name] = this.#reconcileNode(field.value, `${pointer}/fields/${index}/value`, before?.[name], next[name]);
        });

        return SnapshotComparer.#sameFields(before, fields) ? before : Object.freeze(fields);
    }

    /** The tolerance of the member that produced the value, which a field of its value shares; null for a value that is no member's. */
    #toleranceOf(node, pointer) {
        if (node.kind !== 'member') {
            return null;
        }

        const resolution = this.#resolvedDefinition.getResolution(pointer);

        if (resolution?.kind === 'field') {
            return node.target === undefined ? null : this.#toleranceOf(node.target, `${pointer}/target`);
        }

        return resolution?.declaration?.tolerance ?? null;
    }

    /** The previous value where the next equals it, and the next otherwise, with the branches that are equal shared. */
    static #merge(previous, next, tolerance) {
        if (previous === next) {
            return previous;
        }

        if (typeof previous === 'number' && typeof next === 'number') {
            return tolerance !== null && Math.abs(previous - next) <= tolerance ? previous : next;
        }

        if (Array.isArray(previous) && Array.isArray(next)) {
            const items = next.map((item, index) => (index < previous.length ? SnapshotComparer.#merge(previous[index], item, tolerance) : item));

            return SnapshotComparer.#sameItems(previous, items) ? previous : Object.freeze(items);
        }

        if (SnapshotComparer.#isRecord(previous) && SnapshotComparer.#isRecord(next)) {
            const fields = Object.fromEntries(Object.entries(next).map(([name, field]) => [name, name in previous ? SnapshotComparer.#merge(previous[name], field, tolerance) : field]));

            return SnapshotComparer.#sameFields(previous, fields) ? previous : Object.freeze(fields);
        }

        return next;
    }

    static #sameItems(previous, items) {
        return Array.isArray(previous) && previous.length === items.length && items.every((item, index) => item === previous[index]);
    }

    static #sameFields(previous, fields) {
        if (!SnapshotComparer.#isRecord(previous)) {
            return false;
        }

        const names = Object.keys(fields);

        return names.length === Object.keys(previous).length && names.every(name => fields[name] === previous[name]);
    }

    static #isRecord(value) {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }
}
