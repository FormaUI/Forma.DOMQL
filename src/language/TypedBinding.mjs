/**
 * TypedBinding — a value bound with the type its caller declares for it
 */

export class TypedBinding {
    #value;
    #type;

    /**
     * @param {unknown} value The value bound.
     * @param {string} type The declared type, in DOMQL's type notation.
     */
    constructor(value, type) {
        this.#value = value;
        this.#type = type;
    }

    /** The value bound. */
    get value() {
        return this.#value;
    }

    /** The declared type, in DOMQL's type notation. */
    get type() {
        return this.#type;
    }
}
