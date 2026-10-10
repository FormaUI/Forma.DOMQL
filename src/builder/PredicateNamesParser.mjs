/**
 * PredicateNamesParser — reads the predicate names of a built test from text, as DOMQL text writes them after `is` or `has`: names joined by `and` and `or`, `and` binding tighter, parentheses grouping
 */

import { DomqlError } from '../language/DomqlError.mjs';

/** A name, an operator or a parenthesis. */
const TOKEN = /\s*(\(|\)|[A-Za-z][A-Za-z0-9]*)/y;

/** The words a test joins its names with, which no name can be. */
const OPERATORS = new Set(['and', 'or']);

export class PredicateNamesParser {
    #text;
    #tokens;
    #position = 0;

    /** @param {string} text The names, as `disabled or readOnly`. */
    constructor(text) {
        this.#text = text;
        this.#tokens = PredicateNamesParser.#tokenize(text);
    }

    /**
     * The names as a definition writes a test's names: a literal for each name, and an and or an or of two or more.
     * @param {string} text The names, as `disabled or readOnly`.
     */
    static parse(text) {
        if (typeof text !== 'string') {
            throw DomqlError.structure('A test names its predicates as text, as `is("disabled or readOnly")`', {});
        }

        const names = new PredicateNamesParser(text);
        const node = names.#parseCombination('or');

        if (names.#position < names.#tokens.length) {
            names.#fail(`'${names.#tokens[names.#position]}' follows a complete test`);
        }

        return node;
    }

    static #tokenize(text) {
        const tokens = [];

        TOKEN.lastIndex = 0;

        while (TOKEN.lastIndex < text.length) {
            const start = TOKEN.lastIndex;
            const match = TOKEN.exec(text);

            if (match === null) {
                if (text.slice(start).trim() === '') {
                    break;
                }

                throw DomqlError.structure(`The test '${text}' names its predicates by names, and, or and parentheses`, {});
            }

            tokens.push(match[1]);
        }

        return tokens;
    }

    /** An or of ands, or an and of names, flattened as a definition writes them. */
    #parseCombination(operator) {
        const parseOperand = operator === 'or' ? () => this.#parseCombination('and') : () => this.#parseName();
        const operands = [parseOperand()];

        while (this.#tokens[this.#position] === operator) {
            this.#position++;
            operands.push(parseOperand());
        }

        return operands.length === 1 ? operands[0] : { kind: operator, operands };
    }

    #parseName() {
        const token = this.#tokens[this.#position];

        if (token === '(') {
            this.#position++;

            const node = this.#parseCombination('or');

            if (this.#tokens[this.#position] !== ')') {
                this.#fail('a parenthesis is never closed');
            }

            this.#position++;

            return node;
        }

        if (token === undefined || token === ')' || OPERATORS.has(token)) {
            this.#fail(token === undefined ? 'it ends where a name should be' : `a name should come before '${token}'`);
        }

        this.#position++;

        return { kind: 'literal', value: token };
    }

    #fail(problem) {
        throw DomqlError.structure(`The test '${this.#text}' cannot be read: ${problem}`, {});
    }
}
