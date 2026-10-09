/**
 * Domql — creates DOMQL queries from text and from definitions
 */

import { Bindings } from './language/Bindings.mjs';
import { DefinitionValidator } from './language/DefinitionValidator.mjs';
import { DomqlQuery } from './language/DomqlQuery.mjs';
import { ParsedTexts } from './language/ParsedTexts.mjs';

export class Domql {
    /**
     * Parses text into a query, binding its parameters.
     * @param {string} text The query text.
     * @param {Record<string, unknown>} bindings Each parameter's name and the value it is bound to.
     */
    static parse(text, bindings = {}) {
        if (typeof text !== 'string') {
            throw new TypeError('A query text is a string');
        }

        return new DomqlQuery(ParsedTexts.parse(text), new Bindings(bindings));
    }

    /**
     * Creates a query from its definition, binding its parameters.
     * @param {object} definition The query's definition.
     * @param {Record<string, unknown>} bindings Each parameter's name and the value it is bound to.
     */
    static create(definition, bindings = {}) {
        return new DomqlQuery(new DefinitionValidator().validate(definition), new Bindings(bindings));
    }
}
