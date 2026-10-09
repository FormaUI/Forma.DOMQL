/**
 * TypeNotation — DOMQL's types as a binding declares them: how one is read, what a value's type is, and whether a value fits one
 */

import { Names } from './Names.mjs';

/**
 * @typedef {{ kind: 'number' | 'string' | 'boolean' | 'element', isNullable: boolean }
 *     | { kind: 'list', item: Type, isNullable: boolean }
 *     | { kind: 'object', fields: Map<string, Type>, isNullable: boolean }} Type
 */

const SCALARS = new Set(['number', 'string', 'boolean', 'element']);

export class TypeNotation {
    /** Reads the notation into a type, or null where it is not a type a binding can declare. */
    static parse(text) {
        if (typeof text !== 'string') {
            return null;
        }

        const reader = new Reader(text);
        const type = reader.readType();

        return type !== null && reader.isAtEnd ? type : null;
    }

    /** The type a value reveals, or null where it reveals none: null, an empty list, a list holding a null, a list of items of different types or an object with such a field. */
    static infer(value) {
        if (value === null || value === undefined) {
            return null;
        }

        if (typeof Element !== 'undefined' && value instanceof Element) {
            return { kind: 'element', isNullable: false };
        }

        switch (typeof value) {
            case 'number':
            case 'string':
            case 'boolean':
                return { kind: typeof value, isNullable: false };
            default:
                break;
        }

        if (Array.isArray(value)) {
            const items = value.map(item => TypeNotation.infer(item));

            if (items.length === 0 || items.some(item => item === null) || items.some(item => !TypeNotation.#same(item, items[0]))) {
                return null;
            }

            return { kind: 'list', item: items[0], isNullable: false };
        }

        const fields = new Map();

        for (const [name, field] of Object.entries(value)) {
            const type = TypeNotation.infer(field);

            if (type === null) {
                return null;
            }

            fields.set(name, type);
        }

        return { kind: 'object', fields, isNullable: false };
    }

    /** Whether the value fits the type in every part. */
    static fits(value, type) {
        if (value === null || value === undefined) {
            return type.isNullable;
        }

        switch (type.kind) {
            case 'number':
                return typeof value === 'number' && Number.isFinite(value);
            case 'string':
                return typeof value === 'string';
            case 'boolean':
                return typeof value === 'boolean';
            case 'element':
                return typeof Element !== 'undefined' && value instanceof Element;
            case 'list':
                return Array.isArray(value) && value.every(item => TypeNotation.fits(item, type.item));
            default: {
                if (typeof value !== 'object' || Array.isArray(value)) {
                    return false;
                }

                const names = Object.keys(value);

                return names.length === type.fields.size && names.every(name => type.fields.has(name) && TypeNotation.fits(value[name], type.fields.get(name)));
            }
        }
    }

    static #same(type, other) {
        if (type.kind !== other.kind || type.isNullable !== other.isNullable) {
            return false;
        }

        if (type.kind === 'list') {
            return TypeNotation.#same(type.item, other.item);
        }

        if (type.kind === 'object') {
            return type.fields.size === other.fields.size && [...type.fields].every(([name, field]) => other.fields.has(name) && TypeNotation.#same(field, other.fields.get(name)));
        }

        return true;
    }
}

class Reader {
    #text;
    #offset = 0;

    constructor(text) {
        this.#text = text;
    }

    get isAtEnd() {
        this.#skipSpace();

        return this.#offset === this.#text.length;
    }

    readType() {
        this.#skipSpace();

        const type = this.#readBase();

        if (type === null) {
            return null;
        }

        if (this.#text[this.#offset] === '?') {
            this.#offset++;
            type.isNullable = true;
        }

        return type;
    }

    #readBase() {
        if (this.#text[this.#offset] === '{') {
            return this.#readObject();
        }

        const word = /[A-Za-z]+/y;
        word.lastIndex = this.#offset;
        const match = word.exec(this.#text);

        if (match === null) {
            return null;
        }

        this.#offset = word.lastIndex;

        if (SCALARS.has(match[0])) {
            return { kind: match[0], isNullable: false };
        }

        if (match[0] !== 'list' || !this.#take('<')) {
            return null;
        }

        const item = this.readType();

        return item !== null && this.#take('>') ? { kind: 'list', item, isNullable: false } : null;
    }

    #readObject() {
        this.#offset++;

        const fields = new Map();

        for (;;) {
            this.#skipSpace();

            const name = /[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*/y;
            name.lastIndex = this.#offset;
            const match = name.exec(this.#text);

            if (match === null || !Names.isName(match[0]) || fields.has(match[0])) {
                return null;
            }

            this.#offset = name.lastIndex;

            if (!this.#take(':')) {
                return null;
            }

            const field = this.readType();

            if (field === null) {
                return null;
            }

            fields.set(match[0], field);

            if (this.#take('}')) {
                return { kind: 'object', fields, isNullable: false };
            }

            if (!this.#take(',')) {
                return null;
            }
        }
    }

    #take(character) {
        this.#skipSpace();

        if (this.#text[this.#offset] !== character) {
            return false;
        }

        this.#offset++;

        return true;
    }

    #skipSpace() {
        while (/\s/.test(this.#text[this.#offset] ?? '')) {
            this.#offset++;
        }
    }
}
