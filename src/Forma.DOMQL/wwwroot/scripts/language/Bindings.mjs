/**
 * Bindings — the values a query's parameters are bound to, by name
 */

import { DomqlError } from './DomqlError.mjs';
import { Names } from './Names.mjs';

/** The roots, predefined parameters no binding takes. */
const ROOTS = new Set(['document', 'window']);

export class Bindings {
    /** @type {Map<string, unknown>} */
    #values = new Map();

    /** @param {Record<string, unknown>} bindings Each parameter's name and the value it is bound to. */
    constructor(bindings = {}) {
        if (!Bindings.#isPlainObject(bindings)) {
            throw DomqlError.structure('Bindings are a plain object of names and the values bound to them', {});
        }

        for (const [name, value] of Object.entries(bindings)) {
            if (!Names.isName(name)) {
                throw DomqlError.structure('A binding is named as a parameter is, a letter followed by letters and digits, and never true, false or null in any case', { binding: name });
            }

            const folded = Names.fold(name);

            if (ROOTS.has(folded)) {
                throw DomqlError.structure(`'${name}' names a root, which no binding takes`, { binding: name });
            }

            if (this.#values.has(folded)) {
                throw DomqlError.structure(`Two bindings are named '${name}', differing at most in case`, { binding: name });
            }

            if (!Bindings.#isBindable(value, new Set())) {
                throw DomqlError.structure('A binding is an element, or data: a number, a string, a Boolean, null, a list or an object', { binding: name });
            }

            this.#values.set(folded, value);
        }
    }

    /** Whether a value is bound to the name, matching regardless of case. */
    has(name) {
        return this.#values.has(Names.fold(name));
    }

    /** The value bound to the name, matching regardless of case. */
    get(name) {
        return this.#values.get(Names.fold(name));
    }

    static #isPlainObject(value) {
        if (typeof value !== 'object' || value === null) {
            return false;
        }

        const prototype = Object.getPrototypeOf(value);

        return prototype === Object.prototype || prototype === null;
    }

    static #isBindable(value, ancestors) {
        if (typeof Element !== 'undefined' && value instanceof Element) {
            return true;
        }

        return Bindings.#isData(value, ancestors);
    }

    static #isData(value, ancestors) {
        if (value === null || typeof value === 'string' || typeof value === 'boolean') {
            return true;
        }

        if (typeof value === 'number') {
            return Number.isFinite(value);
        }

        if (typeof value !== 'object' || ancestors.has(value)) {
            return false;
        }

        if (!Array.isArray(value) && !Bindings.#isPlainObject(value)) {
            return false;
        }

        ancestors.add(value);
        const isData = Object.values(value).every(item => Bindings.#isData(item, ancestors));
        ancestors.delete(value);

        return isData;
    }
}
