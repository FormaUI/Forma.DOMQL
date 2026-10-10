/**
 * SnapshotPatcher — the change set that takes one result to the next, and the result a change set gives when applied to the one it was computed against
 */

/**
 * The elements a result's lists were projected from, following the result's shape: a list projected from elements holds the element of each item, and a part that holds no such list is null.
 * The result never holds them, and neither does a change set; they tell two items apart that project to the same data.
 * @typedef {{ elements: (Element | null)[] | null, items: Identities[] } | { fields: Record<string, Identities> } | null} Identities
 */

/**
 * One operation of a change set: a JSON Patch operation limited to replace, add, remove and move, whose paths are JSON Pointers into the result.
 * @typedef {{ op: 'replace' | 'add', path: string, value: unknown } | { op: 'remove', path: string } | { op: 'move', from: string, path: string }} ChangeOperation
 */

export class SnapshotPatcher {
    /**
     * The operations that take the previous result to the next. A list projected from elements changes by element: an element entering is added, one leaving is removed, one changing position is moved, and one whose projection changed is changed inside its item. Any other list changes by position.
     * A branch the next result shares with the previous one is unchanged, so a change the comparer kept within a tolerance sends nothing.
     * @param {unknown} previous The result the change set is computed against.
     * @param {import('./SnapshotPatcher.mjs').Identities} previousIdentities The elements the previous result's lists were projected from.
     * @param {unknown} next The result the change set gives.
     * @param {import('./SnapshotPatcher.mjs').Identities} nextIdentities The elements the next result's lists were projected from.
     * @returns {ChangeOperation[]}
     */
    static between(previous, previousIdentities, next, nextIdentities) {
        const operations = [];

        SnapshotPatcher.#compare(previous, previousIdentities, next, nextIdentities, '', operations);

        return operations;
    }

    /**
     * The result the operations give when applied in order to the state, which is left as it was: a new result is built along the paths that change and shares the rest, frozen.
     * Throws where an operation does not apply, so a change set applies whole or not at all.
     * @param {unknown} state The result the change set was computed against.
     * @param {ChangeOperation[]} operations The change set.
     */
    static apply(state, operations) {
        if (!Array.isArray(operations)) {
            throw new TypeError('A change set is a list of operations');
        }

        return operations.reduce((current, operation) => SnapshotPatcher.#applyOne(current, operation), state);
    }

    static #compare(previous, previousIdentities, next, nextIdentities, path, operations) {
        if (Object.is(previous, next)) {
            return;
        }

        if (Array.isArray(previous) && Array.isArray(next)) {
            SnapshotPatcher.#compareLists(previous, previousIdentities, next, nextIdentities, path, operations);

            return;
        }

        if (SnapshotPatcher.#isRecord(previous) && SnapshotPatcher.#isRecord(next) && SnapshotPatcher.#sameNames(previous, next)) {
            for (const name of Object.keys(next)) {
                SnapshotPatcher.#compare(previous[name], previousIdentities?.fields?.[name] ?? null, next[name], nextIdentities?.fields?.[name] ?? null, `${path}/${SnapshotPatcher.#escape(name)}`, operations);
            }

            return;
        }

        operations.push({ op: 'replace', path, value: next });
    }

    static #compareLists(previous, previousIdentities, next, nextIdentities, path, operations) {
        const previousElements = SnapshotPatcher.#elementsOf(previousIdentities, previous.length);
        const nextElements = SnapshotPatcher.#elementsOf(nextIdentities, next.length);
        const itemOf = (identities, index) => identities?.items?.[index] ?? null;

        if (previousElements === null || nextElements === null) {
            const common = Math.min(previous.length, next.length);

            for (let index = 0; index < common; index++) {
                SnapshotPatcher.#compare(previous[index], itemOf(previousIdentities, index), next[index], itemOf(nextIdentities, index), `${path}/${index}`, operations);
            }

            for (let index = common; index < next.length; index++) {
                operations.push({ op: 'add', path: `${path}/${index}`, value: next[index] });
            }

            for (let index = previous.length - 1; index >= common; index--) {
                operations.push({ op: 'remove', path: `${path}/${index}` });
            }

            return;
        }

        const previousIndex = new Map(previousElements.map((element, index) => [element, index]));
        const nextIndex = new Map(nextElements.map((element, index) => [element, index]));

        // The current snapshot's list as the operations so far leave it, by element.
        const current = [...previousElements];

        for (let index = previous.length - 1; index >= 0; index--) {
            if (!nextIndex.has(previousElements[index])) {
                operations.push({ op: 'remove', path: `${path}/${index}` });
                current.splice(index, 1);
            }
        }

        nextElements.forEach((element, index) => {
            if (current[index] === element) {
                return;
            }

            const from = current.indexOf(element, index);

            if (from === -1) {
                operations.push({ op: 'add', path: `${path}/${index}`, value: next[index] });
            } else {
                operations.push({ op: 'move', from: `${path}/${from}`, path: `${path}/${index}` });
                current.splice(from, 1);
            }

            current.splice(index, 0, element);
        });

        // An item that stayed, wherever it now stands, changes inside it.
        nextElements.forEach((element, index) => {
            const before = previousIndex.get(element);

            if (before !== undefined) {
                SnapshotPatcher.#compare(previous[before], itemOf(previousIdentities, before), next[index], itemOf(nextIdentities, index), `${path}/${index}`, operations);
            }
        });
    }

    /** The element of each item of a list projected from elements, or null where the list is matched by position: it was not projected from elements, an item is null, or one element stands in it twice. */
    static #elementsOf(identities, length) {
        const elements = identities?.elements ?? null;

        if (elements === null || elements.length !== length || elements.some(element => element === null) || new Set(elements).size !== elements.length) {
            return null;
        }

        return elements;
    }

    static #applyOne(state, operation) {
        if (!SnapshotPatcher.#isRecord(operation) || typeof operation.path !== 'string') {
            throw new TypeError('A change set operation names its kind and its path');
        }

        switch (operation.op) {
            case 'replace':
                return SnapshotPatcher.#change(state, SnapshotPatcher.#parse(operation.path), 'replace', operation.value);
            case 'add':
                return SnapshotPatcher.#change(state, SnapshotPatcher.#parse(operation.path), 'add', operation.value);
            case 'remove':
                return SnapshotPatcher.#change(state, SnapshotPatcher.#parse(operation.path), 'remove');
            case 'move': {
                const from = SnapshotPatcher.#parse(operation.from);
                const value = SnapshotPatcher.#read(state, from);

                return SnapshotPatcher.#change(SnapshotPatcher.#change(state, from, 'remove'), SnapshotPatcher.#parse(operation.path), 'add', value);
            }
            default:
                throw new TypeError(`'${operation.op}' is no change set operation: replace, add, remove or move`);
        }
    }

    /** A copy of the node with the change made at the end of the path, sharing what the change does not reach. */
    static #change(node, path, kind, value) {
        if (path.length === 0) {
            if (kind === 'remove') {
                throw new TypeError('A change set cannot remove the whole result');
            }

            return SnapshotPatcher.#freeze(value);
        }

        const [token, ...rest] = path;

        if (Array.isArray(node)) {
            const isLast = rest.length === 0;
            const index = token === '-' && isLast && kind === 'add' ? node.length : SnapshotPatcher.#index(token);
            const limit = isLast && kind === 'add' ? node.length : node.length - 1;

            if (index > limit) {
                throw new TypeError(`The path reaches past the end of a list, at '${token}'`);
            }

            const items = [...node];

            if (!isLast) {
                items[index] = SnapshotPatcher.#change(node[index], rest, kind, value);
            } else if (kind === 'add') {
                items.splice(index, 0, SnapshotPatcher.#freeze(value));
            } else if (kind === 'remove') {
                items.splice(index, 1);
            } else {
                items[index] = SnapshotPatcher.#freeze(value);
            }

            return Object.freeze(items);
        }

        if (SnapshotPatcher.#isRecord(node)) {
            const isLast = rest.length === 0;

            if (!Object.hasOwn(node, token) && !(isLast && kind === 'add')) {
                throw new TypeError(`The path names '${token}', which the result does not hold`);
            }

            const fields = { ...node };

            if (!isLast) {
                fields[token] = SnapshotPatcher.#change(node[token], rest, kind, value);
            } else if (kind === 'remove') {
                delete fields[token];
            } else {
                fields[token] = SnapshotPatcher.#freeze(value);
            }

            return Object.freeze(fields);
        }

        throw new TypeError(`The path reaches into ${node === null ? 'null' : `a ${typeof node}`}, which holds nothing, at '${token}'`);
    }

    static #read(node, path) {
        return path.reduce((current, token) => {
            if (Array.isArray(current)) {
                const index = SnapshotPatcher.#index(token);

                if (index >= current.length) {
                    throw new TypeError(`The path reaches past the end of a list, at '${token}'`);
                }

                return current[index];
            }

            if (SnapshotPatcher.#isRecord(current) && Object.hasOwn(current, token)) {
                return current[token];
            }

            throw new TypeError(`The path names '${token}', which the result does not hold`);
        }, node);
    }

    /** The tokens of a JSON Pointer, unescaped. */
    static #parse(pointer) {
        if (typeof pointer !== 'string' || (pointer !== '' && !pointer.startsWith('/'))) {
            throw new TypeError(`'${pointer}' is no JSON Pointer`);
        }

        return pointer === '' ? [] : pointer.slice(1).split('/').map(token => token.replaceAll('~1', '/').replaceAll('~0', '~'));
    }

    static #index(token) {
        if (!/^(?:0|[1-9][0-9]*)$/.test(token)) {
            throw new TypeError(`'${token}' is no index of a list`);
        }

        return Number(token);
    }

    static #escape(name) {
        return name.replaceAll('~', '~0').replaceAll('/', '~1');
    }

    /** The value as immutable data: a copy frozen throughout, where it is not frozen already. */
    static #freeze(value) {
        if (Array.isArray(value)) {
            return Object.isFrozen(value) ? value : Object.freeze(value.map(item => SnapshotPatcher.#freeze(item)));
        }

        if (SnapshotPatcher.#isRecord(value)) {
            return Object.isFrozen(value) ? value : Object.freeze(Object.fromEntries(Object.entries(value).map(([name, field]) => [name, SnapshotPatcher.#freeze(field)])));
        }

        return value;
    }

    static #sameNames(previous, next) {
        const names = Object.keys(next);

        return names.length === Object.keys(previous).length && names.every(name => Object.hasOwn(previous, name));
    }

    static #isRecord(value) {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }
}
