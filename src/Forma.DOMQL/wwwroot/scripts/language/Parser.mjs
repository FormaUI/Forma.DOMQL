/**
 * Parser — a DOMQL text read into its definition, with where in the text each part of it came from
 */

import { DomqlError } from './DomqlError.mjs';
import { Tokenizer } from './Tokenizer.mjs';

/** @typedef {import('./Tokenizer.mjs').Token} Token */
/** @typedef {{ start: number, end: number }} Span */

const TOKEN_NAMES = {
    name: 'a name',
    literal: 'a literal',
    end: 'the end of the query',
};

export class Parser {
    #text;
    /** @type {Token[]} */
    #tokens;
    #index = 0;
    /** @type {WeakMap<object, Span>} */
    #spans = new WeakMap();

    /** @param {string} text The query text. */
    constructor(text) {
        this.#text = text;
        this.#tokens = new Tokenizer(text).tokenize();
    }

    /** Reads the text into its definition, with the span of text each of its nodes, fields and arguments came from. */
    parse() {
        const query = this.#parseValue();
        this.#expect('end');

        return { definition: { version: 1, query }, spans: this.#spans };
    }

    #parseValue() {
        const start = this.#token.start;
        let node = this.#parseStart();

        for (;;) {
            if (this.#token.type === '.') {
                this.#advance();
                node = this.#parseMember(node, start);
            } else if (this.#token.type === '{') {
                node = this.#parseShape(node, start);
            } else {
                return node;
            }
        }
    }

    #parseStart() {
        const token = this.#token;

        switch (token.type) {
            case '@': {
                this.#advance();
                const name = this.#expect('name');

                return this.#span({ kind: 'parameter', name: name.value }, token.start);
            }
            case 'name':
                return this.#parseMember(null, token.start);
            case 'literal':
                this.#advance();

                return this.#span({ kind: 'literal', value: token.value }, token.start);
            case '{':
                return this.#parseShape(null, token.start);
            default:
                throw this.#unexpected('a value');
        }
    }

    #parseMember(target, start) {
        const name = this.#expect('name');
        const node = target ? { kind: 'member', target, name: name.value, arguments: [] } : { kind: 'member', name: name.value, arguments: [] };

        if (this.#token.type === '(') {
            this.#advance();
            this.#parseList(')', () => node.arguments.push(this.#parseEntry()));
        } else if (this.#token.type === 'literal') {
            const literal = this.#token;
            this.#advance();

            const value = this.#span({ kind: 'literal', value: literal.value }, literal.start);
            node.arguments.push(this.#span({ value }, literal.start));
        }

        return this.#span(node, start);
    }

    #parseShape(target, start) {
        this.#expect('{');

        const node = target ? { kind: 'shape', target, fields: [] } : { kind: 'shape', fields: [] };
        this.#parseList('}', () => node.fields.push(this.#parseEntry()));

        return this.#span(node, start);
    }

    /** Reads entries separated by commas up to the closing token, a comma after the last allowed. */
    #parseList(closing, parseEntry) {
        while (this.#token.type !== closing) {
            parseEntry();

            if (this.#token.type === ',') {
                this.#advance();
            } else if (this.#token.type !== closing) {
                throw this.#unexpected(`',' or '${closing}'`);
            }
        }

        this.#advance();
    }

    /** Reads a field or an argument: a value, named where a name and a colon come first. */
    #parseEntry() {
        const start = this.#token.start;

        if (this.#token.type === 'literal' && this.#tokens[this.#index + 1].type === ':') {
            throw DomqlError.syntax(`'${this.#text.slice(this.#token.start, this.#token.end)}' is a literal, and names nothing`, this.#text, start);
        }

        if (this.#token.type === 'name' && this.#tokens[this.#index + 1].type === ':') {
            const name = this.#token.value;
            this.#index += 2;

            return this.#span({ name, value: this.#parseValue() }, start);
        }

        return this.#span({ value: this.#parseValue() }, start);
    }

    get #token() {
        return this.#tokens[this.#index];
    }

    #advance() {
        this.#index++;
    }

    #expect(type) {
        const token = this.#token;

        if (token.type !== type) {
            throw this.#unexpected(TOKEN_NAMES[type] ?? `'${type}'`);
        }

        this.#advance();

        return token;
    }

    #span(part, start) {
        this.#spans.set(part, { start, end: this.#tokens[this.#index - 1].end });

        return part;
    }

    #unexpected(expected) {
        const token = this.#token;
        const found = token.type === 'end' ? TOKEN_NAMES.end : `'${this.#text.slice(token.start, token.end)}'`;

        return DomqlError.syntax(`Expected ${expected}, found ${found}`, this.#text, token.start);
    }
}
