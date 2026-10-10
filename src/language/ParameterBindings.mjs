/**
 * ParameterBindings — the values a query's parameters are bound to, by name
 */

import { DomqlError } from './DomqlError.mjs';
import { Names } from './Names.mjs';
import { TypeNotation } from './TypeNotation.mjs';
import { TypedBinding } from './TypedBinding.mjs';

/** The roots, predefined parameters no binding takes. */
const ROOTS = new Set(['document', 'window']);

export class ParameterBindings {
    /** @type {Map<string, unknown>} */
    #values = new Map();

    /** @type {Map<string, import('./TypeNotation.mjs').Type>} */
    #types = new Map();

    /** @param {Record<string, unknown>} parameters Each parameter's name and the value it is bound to, or a typed binding of one. */
    constructor(parameters = {}) {
        if (!ParameterBindings.#isPlainObject(parameters)) {
            throw DomqlError.structure('Bindings are a plain object of names and the values bound to them', {});
        }

        for (const [name, binding] of Object.entries(parameters)) {
            const isTyped = binding instanceof TypedBinding;
            const value = isTyped ? binding.value : binding;

            if (!Names.isName(name)) {
                throw DomqlError.structure('A binding is named as a parameter is, a letter followed by letters and digits, and never true, false, null, is, has, and or or', { binding: name });
            }

            if (ROOTS.has(name)) {
                throw DomqlError.structure(`'${name}' names a root, which no binding takes`, { binding: name });
            }

            if (!ParameterBindings.#isBindable(value, new Set())) {
                throw DomqlError.structure('A binding is an element, or data: a number, a string, a Boolean, null, a list or an object', { binding: name });
            }

            this.#types.set(name, ParameterBindings.#getType(name, value, isTyped ? binding.type : null));
            this.#values.set(name, value);
        }
    }

    /** Whether a value is bound to the name. */
    has(name) {
        return this.#values.has(name);
    }

    /** The value bound to the name. */
    get(name) {
        return this.#values.get(name);
    }

    /** The type of the value bound to the name, which the value reveals or its binding declared. */
    typeOf(name) {
        return this.#types.get(name);
    }

    /**
     * What resolving a definition against these bindings depends on: each name with its type, and its value where that is a string, a number, a Boolean or null, since a bound string can select what a member reads.
     * Two bindings with one signature resolve a definition alike, so they can share its resolution.
     */
    get signature() {
        return [...this.#types.keys()].sort().map(name => {
            const value = this.#values.get(name);
            const isPrimitive = value === null || ['string', 'number', 'boolean'].includes(typeof value);

            return `${name}:${ParameterBindings.#describe(this.#types.get(name))}${isPrimitive ? `=${JSON.stringify(value)}` : ''}`;
        }).join(';');
    }

    static #describe(type) {
        const nullable = type.isNullable ? '?' : '';

        switch (type.kind) {
            case 'list':
                return `list<${ParameterBindings.#describe(type.item)}>${nullable}`;
            case 'object':
                return `{${[...type.fields].map(([name, field]) => `${name}:${ParameterBindings.#describe(field)}`).join(',')}}${nullable}`;
            default:
                return `${type.kind}${nullable}`;
        }
    }

    /** The value's type: the declared one where it fits every part of the value, else the one the value reveals. */
    static #getType(name, value, declared) {
        if (declared === null) {
            const revealed = TypeNotation.infer(value);

            if (revealed === null) {
                throw DomqlError.structure('This value reveals no type, being null, an empty list or holding one; bind it with the type it has. A list of items of different types has none to declare, since DOMQL has no union types', { binding: name });
            }

            return revealed;
        }

        const type = TypeNotation.parse(declared);

        if (type === null) {
            throw DomqlError.structure(`'${declared}' is not a type a binding can declare: number, string, boolean, element, list<T> or { field: type }, each with an optional ?`, { binding: name });
        }

        if (!TypeNotation.fits(value, type)) {
            throw DomqlError.structure(`The value does not fit the declared type '${declared}' in every part`, { binding: name });
        }

        return type;
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

        return ParameterBindings.#isData(value, ancestors);
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

        if (!Array.isArray(value) && !ParameterBindings.#isPlainObject(value)) {
            return false;
        }

        ancestors.add(value);
        const isData = Object.values(value).every(item => ParameterBindings.#isBindable(item, ancestors));
        ancestors.delete(value);

        return isData;
    }
}
