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
     * An item of a list projected from elements is compared with the previous item of the same element, wherever it stood, so a reordered list shares the items that did not change.
     * @param {unknown} previous The snapshot last reported.
     * @param {import('./SnapshotPatcher.mjs').Identities} previousIdentities The elements the previous snapshot's lists were projected from.
     * @param {unknown} next The snapshot to compare, which is frozen.
     * @param {import('./SnapshotPatcher.mjs').Identities} nextIdentities The elements the next snapshot's lists were projected from, which it follows.
     */
    reconcile(previous, previousIdentities, next, nextIdentities) {
        return this.#reconcileNode(this.#resolvedDefinition.definition.query, previous, previousIdentities, next, nextIdentities);
    }

    #reconcileNode(node, previous, previousIdentities, next, nextIdentities) {
        if (node.kind !== 'shape' || next === null || typeof next !== 'object') {
            return SnapshotComparer.#merge(previous, next, this.#toleranceOf(node));
        }

        if (!Array.isArray(next)) {
            return this.#reconcileFields(node, previous, previousIdentities, next, nextIdentities);
        }

        // A shape that follows a list projects each of its items, which are matched by element where the list was projected from elements and by position otherwise.
        const before = Array.isArray(previous) ? previous : [];
        const matched = SnapshotComparer.#matchByElement(previousIdentities, before.length, nextIdentities, next.length);
        const items = next.map((item, index) => {
            const at = matched === null ? index : matched[index];

            return item === null ? null : this.#reconcileFields(node, at === -1 ? undefined : before[at], previousIdentities?.items?.[at] ?? null, item, nextIdentities?.items?.[index] ?? null);
        });

        return SnapshotComparer.#sameItems(previous, items) ? previous : Object.freeze(items);
    }

    #reconcileFields(node, previous, previousIdentities, next, nextIdentities) {
        const before = SnapshotComparer.#isRecord(previous) ? previous : undefined;
        const fields = {};

        node.fields.forEach(field => {
            const name = field.name ?? Names.inferField(field.value);

            fields[name] = this.#reconcileNode(field.value, before?.[name], previousIdentities?.fields?.[name] ?? null, next[name], nextIdentities?.fields?.[name] ?? null);
        });

        return SnapshotComparer.#sameFields(before, fields) ? before : Object.freeze(fields);
    }

    /** For each next item, the index of the previous item projected from its element, or -1 for an element that entered; null where either list is matched by position. */
    static #matchByElement(previousIdentities, previousLength, nextIdentities, nextLength) {
        const previousElements = previousIdentities?.elements ?? null;
        const nextElements = nextIdentities?.elements ?? null;
        const isKeyed = (elements, length) => elements !== null && elements.length === length && !elements.includes(null) && new Set(elements).size === length;

        if (!isKeyed(previousElements, previousLength) || !isKeyed(nextElements, nextLength)) {
            return null;
        }

        const index = new Map(previousElements.map((element, at) => [element, at]));

        return nextElements.map(element => index.get(element) ?? -1);
    }

    /** The tolerance of the member that produced the value, which a field of its value shares; null for a value that is no member's. */
    #toleranceOf(node) {
        if (node.kind !== 'member') {
            return null;
        }

        const resolution = this.#resolvedDefinition.resolutionOf(node);

        if (resolution?.kind === 'field') {
            return node.target === undefined ? null : this.#toleranceOf(node.target);
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
