/**
 * Names — DOMQL's names: how one is spelled, and the name a field infers
 */

/** A letter followed by letters and digits, with single hyphens between them. */
const PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/;

/** The literal tokens no name can be. */
const RESERVED = new Set(['true', 'false', 'null']);

/** The members that read a name from a string, whose field takes the name's last segment. */
const READS = new Set(['get', 'is', 'has']);

export class Names {
    /** Whether the text is a name: a letter followed by letters and digits, with single hyphens between them, and no reserved literal. */
    static isName(text) {
        return typeof text === 'string' && PATTERN.test(text) && !RESERVED.has(text);
    }

    /** The name a field holding the value infers, as the definition spells it, or null where it infers none. */
    static inferField(value) {
        if (value.kind === 'shape') {
            return value.target ? Names.inferField(value.target) : null;
        }

        if (value.kind !== 'member') {
            return null;
        }

        return READS.has(value.name) ? Names.#inferRead(value) : value.name;
    }

    /** The last segment of the name a `get`, `is` or `has` reads by a literal; a bound name infers nothing. */
    static #inferRead(read) {
        const [argument] = read.arguments;

        if (read.arguments.length !== 1 || argument.name !== undefined || argument.value.kind !== 'literal' || typeof argument.value.value !== 'string') {
            return null;
        }

        const name = argument.value.value.split('.').at(-1);

        return Names.isName(name) ? name : null;
    }
}
