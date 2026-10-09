/**
 * Domql — creates DOMQL queries from text and from definitions
 */

import { Bindings } from './language/Bindings.mjs';
import { DefinitionValidator } from './language/DefinitionValidator.mjs';
import { DomqlModule } from './language/DomqlModule.mjs';
import { DomqlQuery } from './language/DomqlQuery.mjs';
import { Evaluator } from './language/Evaluator.mjs';
import { ParsedTexts } from './language/ParsedTexts.mjs';
import { Registry } from './language/Registry.mjs';
import { RequestResolver } from './language/RequestResolver.mjs';
import { Specification } from './language/Specification.mjs';
import { TypedBinding } from './language/TypedBinding.mjs';
import { Vocabulary } from './language/Vocabulary.mjs';

export class Domql {
    /**
     * Creates a module from the vocabulary it declares and the functions that carry the members out.
     * @param {string} name The module's name.
     * @param {object} contents What the module declares.
     * @param {Record<string, Function> | null} functions The functions the members name.
     */
    static createModule(name, contents, functions = null) {
        return new DomqlModule(name, contents, functions);
    }

    /** The version of the specification this implementation follows, as major.minor.revision. */
    static get specificationVersion() {
        return Specification.version;
    }

    static #registry = new Registry([Vocabulary.module]);

    /** Registers a module's vocabulary, which every query resolved afterwards may use. */
    static registerModule(module) {
        Domql.#registry.register(module);
    }

    /**
     * Resolves a query against the registered vocabulary and types it, without evaluating anything.
     * @param {DomqlQuery} query The query to resolve.
     * @param {{ watch?: boolean, acceptPartialObservation?: boolean }} options How the query will be carried out.
     */
    static resolve(query, options = {}) {
        return new RequestResolver(Domql.#registry, query.bindings, ParsedTexts.locationsOf(query.definition), options).resolve(query.definition);
    }

    /**
     * Reads a query once, answering immutable data that holds nothing of the document.
     * @param {DomqlQuery} query The query to read.
     * @param {Window} window The window `@window` stands for, and whose document `@document` stands for.
     */
    static read(query, window = globalThis.window) {
        const request = Domql.resolve(query);

        return new Evaluator(Domql.#registry, request, query.bindings, { window, document: window.document }, ParsedTexts.locationsOf(query.definition)).read();
    }

    /**
     * Binds a value with the type it has, for a value that reveals none, such as null or an empty list.
     * @param {unknown} value The value bound.
     * @param {string} type The type, as `element?`, `list<number>` or `{ id: string }`.
     */
    static bind(value, type) {
        return new TypedBinding(value, type);
    }

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
