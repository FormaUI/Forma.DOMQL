/**
 * Tokenizer — the tokens of a DOMQL text
 */

import { DomqlError } from './DomqlError.mjs';

/**
 * @typedef {object} Token
 * @property {'name' | 'literal' | 'end' | '@' | '.' | ',' | ':' | '(' | ')' | '{' | '}'} type
 * @property {unknown} [value] A name's text or a literal's value.
 * @property {number} start
 * @property {number} end
 */

const PUNCTUATION = new Set(['@', '.', ',', ':', '(', ')', '{', '}']);
const KEYWORDS = new Map([['true', true], ['false', false], ['null', null]]);
const NAME = /[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*/y;
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const SPACE = /\s/;

export class Tokenizer {
    #text;
    #offset = 0;

    /** @param {string} text The query text. */
    constructor(text) {
        this.#text = text;
    }

    /** Reads every token of the text, ending with an `end` token. */
    tokenize() {
        /** @type {Token[]} */
        const tokens = [];

        for (let token = this.#read(); ; token = this.#read()) {
            tokens.push(token);

            if (token.type === 'end') {
                return tokens;
            }
        }
    }

    #read() {
        this.#skipSpaceAndComments();

        const start = this.#offset;

        if (start >= this.#text.length) {
            return { type: 'end', start, end: start };
        }

        const character = this.#text[start];

        if (PUNCTUATION.has(character)) {
            this.#offset++;

            return { type: character, start, end: this.#offset };
        }

        if (character === '"') {
            return this.#readString(start);
        }

        if (character === '-' || (character >= '0' && character <= '9')) {
            return this.#readNumber(start);
        }

        NAME.lastIndex = start;

        if (NAME.test(this.#text)) {
            this.#offset = NAME.lastIndex;

            const name = this.#text.slice(start, this.#offset);

            return KEYWORDS.has(name)
                ? { type: 'literal', value: KEYWORDS.get(name), start, end: this.#offset }
                : { type: 'name', value: name, start, end: this.#offset };
        }

        throw DomqlError.syntax(`Unexpected '${character}'`, this.#text, start);
    }

    #skipSpaceAndComments() {
        while (this.#offset < this.#text.length) {
            const character = this.#text[this.#offset];

            if (SPACE.test(character)) {
                this.#offset++;
            } else if (this.#text.startsWith('//', this.#offset)) {
                const lineEnd = this.#text.indexOf('\n', this.#offset);
                this.#offset = lineEnd === -1 ? this.#text.length : lineEnd + 1;
            } else if (this.#text.startsWith('/*', this.#offset)) {
                const commentEnd = this.#text.indexOf('*/', this.#offset + 2);

                if (commentEnd === -1) {
                    throw DomqlError.syntax('A block comment is never closed', this.#text, this.#offset);
                }

                this.#offset = commentEnd + 2;
            } else {
                return;
            }
        }
    }

    #readString(start) {
        let value = '';
        let offset = start + 1;

        while (offset < this.#text.length) {
            const character = this.#text[offset];

            if (character === '"') {
                this.#offset = offset + 1;

                return { type: 'literal', value, start, end: this.#offset };
            }

            if (character === '\\') {
                const escaped = this.#text[offset + 1];

                if (escaped !== '"' && escaped !== '\\') {
                    throw DomqlError.syntax('A string escapes only \\" and \\\\', this.#text, offset);
                }

                value += escaped;
                offset += 2;
            } else {
                value += character;
                offset++;
            }
        }

        throw DomqlError.syntax('A string is never closed', this.#text, start);
    }

    #readNumber(start) {
        NUMBER.lastIndex = start;

        if (!NUMBER.test(this.#text)) {
            throw DomqlError.syntax('A number is written as in JSON', this.#text, start);
        }

        this.#offset = NUMBER.lastIndex;

        return { type: 'literal', value: Number(this.#text.slice(start, this.#offset)), start, end: this.#offset };
    }
}
