/**
 * Type — a DOMQL type: a named type, a list, an occurrence source, a shape or a type variable, each nullable or not
 */

const NAME = /^@?[A-Za-z][A-Za-z0-9]*$/;
const VARIABLE = /^(?:[A-Z]|@[A-Za-z][A-Za-z0-9]*)$/;

export class Type {
    /** @type {Map<string, Type | null>} */
    static #parsed = new Map();

    /** The type's kind: named, list, occurrence, shape, variable or null. */
    kind;

    /** The type's name, for a named type or a variable. */
    name;

    /** The type of a list's or an occurrence's items. */
    item;

    /** A shape's fields by name. */
    fields;

    /** Whether the type admits null. */
    isNullable;

    constructor(kind, { name = null, item = null, fields = null, isNullable = false } = {}) {
        this.kind = kind;
        this.name = name;
        this.item = item;
        this.fields = fields;
        this.isNullable = isNullable;
        Object.freeze(this);
    }

    /** The type the notation writes, or null where it is not a type. */
    static parse(text) {
        if (!Type.#parsed.has(text)) {
            Type.#parsed.set(text, new Reader(text).readAll());
        }

        return Type.#parsed.get(text);
    }

    /** A named type. */
    static named(name, isNullable = false) {
        return new Type('named', { name, isNullable });
    }

    /** A list of the item type. */
    static list(item, isNullable = false) {
        return new Type('list', { item, isNullable });
    }

    /** An occurrence source whose occurrences are of the item type. */
    static occurrence(item, isNullable = false) {
        return new Type('occurrence', { item, isNullable });
    }

    /** The shape of the fields, by name. */
    static shape(fields, isNullable = false) {
        return new Type('shape', { fields, isNullable });
    }

    /** The type of a written null. */
    static get null() {
        return Type.#null;
    }

    static #null = new Type('null', { isNullable: true });

    /** The same type, admitting null. */
    toNullable() {
        return this.isNullable ? this : new Type(this.kind, { name: this.name, item: this.item, fields: this.fields, isNullable: true });
    }

    /** The same type, admitting no null. */
    toNonNullable() {
        return !this.isNullable || this.kind === 'null' ? this : new Type(this.kind, { name: this.name, item: this.item, fields: this.fields, isNullable: false });
    }

    /** Whether the two types are the same, nullability included. */
    equals(other) {
        if (this.kind !== other.kind || this.name !== other.name || this.isNullable !== other.isNullable) {
            return false;
        }

        if (this.item !== null) {
            return this.item.equals(other.item);
        }

        if (this.fields !== null) {
            return this.fields.size === other.fields.size && [...this.fields].every(([name, field]) => other.fields.get(name)?.equals(field) === true);
        }

        return true;
    }

    /** The notation of the type. */
    toString() {
        let text;

        switch (this.kind) {
            case 'list':
            case 'occurrence':
                text = `${this.kind}<${this.item}>`;
                break;
            case 'shape':
                text = `{ ${[...this.fields].map(([name, field]) => `${name}: ${field}`).join(', ')} }`;
                break;
            case 'null':
                return 'null';
            default:
                text = this.name;
        }

        return this.isNullable ? `${text}?` : text;
    }

    /** Matches a pattern's variables against the type, binding each to the part it stands for, or answers false where the shapes differ. */
    static unify(pattern, actual, bindings) {
        if (pattern.kind === 'variable') {
            const bound = bindings.get(pattern.name);

            if (bound === undefined) {
                bindings.set(pattern.name, actual);

                return true;
            }

            return bound.toNonNullable().equals(actual.toNonNullable());
        }

        if (pattern.kind !== actual.kind || pattern.name !== actual.name) {
            return false;
        }

        return pattern.item === null || Type.unify(pattern.item, actual.item, bindings);
    }

    /** The type with each bound variable replaced by what it stands for. */
    static substitute(type, bindings) {
        if (type.kind === 'variable') {
            const bound = bindings.get(type.name);

            if (bound === undefined) {
                return type;
            }

            return type.isNullable ? bound.toNullable() : bound;
        }

        if (type.item !== null) {
            return new Type(type.kind, { item: Type.substitute(type.item, bindings), isNullable: type.isNullable });
        }

        return type;
    }

    /** Whether a value of the actual type may stand where the expected type is declared, a list or an occurrence by its items. */
    static isAssignable(actual, expected) {
        if (actual.kind === 'null') {
            return expected.isNullable;
        }

        if (actual.isNullable && !expected.isNullable) {
            return false;
        }

        if (actual.kind !== expected.kind || actual.name !== expected.name) {
            return false;
        }

        return actual.item === null || Type.isAssignable(actual.item, expected.item);
    }
}

class Reader {
    #text;
    #offset = 0;

    constructor(text) {
        this.#text = typeof text === 'string' ? text : '';
    }

    readAll() {
        const type = this.#readType();

        return type !== null && this.#offset === this.#text.length ? type : null;
    }

    #readType() {
        const word = /@?[A-Za-z][A-Za-z0-9]*/y;
        word.lastIndex = this.#offset;
        const match = word.exec(this.#text);

        if (match === null || !NAME.test(match[0])) {
            return null;
        }

        this.#offset = word.lastIndex;

        let type;

        if (this.#text[this.#offset] === '<') {
            if (match[0] !== 'list' && match[0] !== 'occurrence') {
                return null;
            }

            this.#offset++;
            const item = this.#readType();

            if (item === null || this.#text[this.#offset] !== '>') {
                return null;
            }

            this.#offset++;
            type = new Type(match[0], { item });
        } else if (match[0] === 'null') {
            type = Type.null;
        } else if (VARIABLE.test(match[0])) {
            type = new Type('variable', { name: match[0] });
        } else if (match[0] === 'list' || match[0] === 'occurrence') {
            return null;
        } else {
            type = Type.named(match[0]);
        }

        if (this.#text[this.#offset] === '?') {
            this.#offset++;
            type = type.toNullable();
        }

        return type;
    }
}
