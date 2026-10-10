/**
 * Names — DOMQL's names: how one is spelled, and the name a field infers
 */

/** A letter followed by letters and digits, which is also a JavaScript identifier. */
const PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

/** The literal tokens and the operators, which no name can be. */
const RESERVED = new Set(['true', 'false', 'null', 'is', 'has', 'and', 'or']);

export class Names {
    /** Whether the text is a name: a letter followed by letters and digits, and no reserved literal or operator. */
    static isName(text) {
        return typeof text === 'string' && PATTERN.test(text) && !RESERVED.has(text);
    }

    /** The name a field holding the value infers, as the definition spells it, or null where it infers none. */
    static inferField(value) {
        if (value.kind === 'shape') {
            return value.target ? Names.inferField(value.target) : null;
        }

        if (value.kind === 'predicate') {
            return Names.#lastSegment(value.test);
        }

        if (value.kind !== 'member') {
            return null;
        }

        if (value.name !== 'get') {
            return value.name;
        }

        const [argument] = value.arguments;

        return value.arguments.length === 1 && argument.name === undefined ? Names.#lastSegment(argument.value) : null;
    }

    /** The last segment of the name a literal string holds; a bound or combined name infers nothing. */
    static #lastSegment(node) {
        if (node.kind !== 'literal' || typeof node.value !== 'string') {
            return null;
        }

        const name = node.value.split('.').at(-1);

        return Names.isName(name) ? name : null;
    }
}
