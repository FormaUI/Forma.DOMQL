/**
 * Names — DOMQL's names: how one is spelled, how two are compared, and the name a field infers
 */

const PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

/** The literal tokens no name can be, in any case. */
const RESERVED = new Set(['true', 'false', 'null']);

export class Names {
    /** Whether the text is a name: a letter followed by letters and digits, and no reserved literal in any case. */
    static isName(text) {
        return typeof text === 'string' && PATTERN.test(text) && !RESERVED.has(Names.fold(text));
    }

    /** The name in the one case names are compared in, folding ASCII letters alone. */
    static fold(name) {
        return name.replace(/[A-Z]/g, letter => letter.toLowerCase());
    }

    /** The name a field holding the value infers, as the definition spells it, or null where it infers none. */
    static inferField(value) {
        if (value.kind === 'shape') {
            return value.target ? Names.inferField(value.target) : null;
        }

        if (value.kind !== 'member') {
            return null;
        }

        return Names.fold(value.name) === 'get' ? Names.#inferRead(value) : value.name;
    }

    /** The last member of the path a `get` reads by a literal name; a bound name infers nothing. */
    static #inferRead(read) {
        const [argument] = read.arguments;

        if (read.arguments.length !== 1 || argument.name !== undefined || argument.value.kind !== 'literal' || typeof argument.value.value !== 'string') {
            return null;
        }

        const name = argument.value.value.split('.').at(-1);

        return Names.isName(name) ? name : null;
    }
}
