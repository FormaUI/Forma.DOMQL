/**
 * DomqlError — a DOMQL failure and its location
 */

/**
 * @typedef {object} Location
 * @property {string} [pointer] The failing node's JSON Pointer into the definition.
 * @property {number} [offset] The failing text's offset into the query text.
 * @property {number} [line] The failing text's line, from 1.
 * @property {number} [column] The failing text's column, from 1.
 * @property {string} [binding] The failing binding's name.
 * @property {string} [module] The failing module's name.
 * @property {string} [declaration] The failing declaration's name.
 */

export class DomqlError extends Error {
    /** @type {'syntax' | 'structure' | 'validation' | 'module' | 'evaluation'} */
    kind;

    /** @type {Location} */
    location;

    /**
     * @param {'syntax' | 'structure' | 'validation' | 'module' | 'evaluation'} kind The stage the request failed in.
     * @param {string} message What is wrong.
     * @param {Location} location Where it is wrong.
     * @param {{ cause?: unknown }} [options] What caused it.
     */
    constructor(kind, message, location, options = undefined) {
        const place = DomqlError.#describe(location);
        super(place === '' ? message : `${message} (${place})`, options);
        this.name = 'DomqlError';
        this.kind = kind;
        this.location = location;
    }

    /** A text that does not follow the syntax, failing at the offset. */
    static syntax(message, text, offset) {
        return new DomqlError('syntax', message, DomqlError.locate(text, offset));
    }

    /** A definition, or a binding, that does not follow the structure, failing at the location. */
    static structure(message, location) {
        return new DomqlError('structure', message, location);
    }

    /** A request that does not follow the vocabulary, failing at the location. */
    static validation(message, location) {
        return new DomqlError('validation', message, location);
    }

    /** A request that fails as it is carried out, at the location of the part that failed. */
    static evaluation(message, location, options) {
        return new DomqlError('evaluation', message, location, options);
    }

    /** A module whose declarations do not follow the declaration contract, failing at the location. */
    static module(message, location) {
        return new DomqlError('module', message, location);
    }

    /** The offset's line and column in the text. */
    static locate(text, offset) {
        let line = 1;
        let lineStart = 0;

        for (let index = text.indexOf('\n'); index !== -1 && index < offset; index = text.indexOf('\n', index + 1)) {
            line++;
            lineStart = index + 1;
        }

        return { offset, line, column: offset - lineStart + 1 };
    }

    static #describe(location) {
        const parts = [];

        if (location.line !== undefined) {
            parts.push(`line ${location.line}, column ${location.column}`);
        }

        if (location.pointer !== undefined) {
            parts.push(`at ${location.pointer === '' ? 'the definition' : location.pointer}`);
        }

        if (location.binding !== undefined) {
            parts.push(`in the binding '${location.binding}'`);
        }

        if (location.module !== undefined) {
            parts.push(`in the module '${location.module}'`);
        }

        if (location.declaration !== undefined) {
            parts.push(`in the declaration '${location.declaration}'`);
        }

        return parts.join(', ');
    }
}
