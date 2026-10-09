/**
 * DomqlModule — a vocabulary's declarations as data, and the functions that carry them out
 */

import { DomqlError } from './DomqlError.mjs';
import { Names } from './Names.mjs';
import { Type } from './Type.mjs';

const KINDS = ['property', 'operation', 'source', 'action', 'behavior'];
const CHANGES = ['constant', 'observable', 'partly-observable', 'unobserved', 'derived'];
const READS = ['fresh', 'maintained', 'captured', 'derived'];
const NULLS = ['propagate', 'accept'];
const SELECTS = ['member', 'predicate', 'occurrence', 'feature'];
const PARAMETER_KINDS = ['value', 'expression'];
const VERBS = ['is', 'has'];

/** The names of the types DOMQL itself defines, which a module cannot declare again. */
const BUILT_IN = new Set(['number', 'string', 'boolean', 'element', 'window', 'document', 'list', 'occurrence', 'null']);

/** The name that identifies the core vocabulary, whose members stand without a namespace. */
const CORE = 'core';

export class DomqlModule {
    #name;
    #declarations;
    #types;
    #events;
    #predicates;
    #features;
    #functions;

    /** Proves a module is the core's, which only the core's own factory can. */
    static #coreToken = Symbol('core');

    /**
     * @param {string} name The module's name, which names its namespace.
     * @param {object} contents What the module declares.
     * @param {object[]} [contents.declarations] The properties, operations, sources, actions and behaviors it adds.
     * @param {object[]} [contents.types] The structured types it declares, each with its fields.
     * @param {object[]} [contents.events] The event types it declares, each with the type of its occurrences.
     * @param {object[]} [contents.predicates] The predicates `is` and `has` read.
     * @param {string[]} [contents.features] The features `supports` names.
     * @param {Record<string, Function> | null} [functions] The functions that carry the declarations out, by the key each declaration names.
     * @param {symbol} [identity] Held by the core vocabulary alone.
     */
    constructor(name, contents = {}, functions = null, identity = undefined) {
        if (!Names.isName(name)) {
            throw DomqlError.module('A module is named as a name is', { module: String(name) });
        }

        if (name === CORE && identity !== DomqlModule.#coreToken) {
            throw DomqlError.module(`'${CORE}' is the core vocabulary's identity, which no other module takes`, { module: name });
        }

        const { declarations = [], types = [], events = [], predicates = [], features = [] } = contents;
        const fail = (message, declaration) => { throw DomqlError.module(message, declaration === undefined ? { module: name } : { module: name, declaration }); };

        this.#name = name;
        this.#types = DomqlModule.#freeze(types.map(type => DomqlModule.#checkType(type, fail)));
        this.#declarations = DomqlModule.#freeze(declarations.map(declaration => DomqlModule.#checkDeclaration(declaration, fail)));
        this.#events = DomqlModule.#freeze(events.map(event => DomqlModule.#checkEvent(event, fail)));
        this.#predicates = DomqlModule.#freeze(predicates.map(predicate => DomqlModule.#checkPredicate(predicate, fail)));
        this.#features = DomqlModule.#freeze(features.map(feature => DomqlModule.#checkFeature(feature, fail)));

        if (functions !== null) {
            for (const declaration of this.#declarations) {
                if (typeof functions[declaration.function] !== 'function') {
                    fail(`The function '${declaration.function}' it names is not among the module's functions`, declaration.name);
                }
            }
        }

        this.#functions = functions;
    }

    /** The core vocabulary's module, whose members occupy the core directly. */
    static core(contents, functions = null) {
        return new DomqlModule(CORE, contents, functions, DomqlModule.#coreToken);
    }

    /** Whether the module is the core vocabulary's. */
    get isCore() {
        return this.#name === CORE;
    }

    /** The module's name. */
    get name() {
        return this.#name;
    }

    /** The members the module adds. */
    get declarations() {
        return this.#declarations;
    }

    /** The structured types the module declares. */
    get types() {
        return this.#types;
    }

    /** The event types the module declares. */
    get events() {
        return this.#events;
    }

    /** The predicates the module declares. */
    get predicates() {
        return this.#predicates;
    }

    /** The features the module declares. */
    get features() {
        return this.#features;
    }

    /** The functions that carry the declarations out, or null for a module that declares and does not yet implement. */
    get functions() {
        return this.#functions;
    }

    static #freeze(items) {
        return Object.freeze(items.map(item => DomqlModule.#deepFreeze(item)));
    }

    static #deepFreeze(value) {
        if (value !== null && typeof value === 'object') {
            Object.values(value).forEach(item => DomqlModule.#deepFreeze(item));
            Object.freeze(value);
        }

        return value;
    }

    static #isTypeText(text) {
        return Type.parse(text) !== null;
    }

    static #checkType(type, fail) {
        if (!Names.isName(type?.name) || BUILT_IN.has(type.name)) {
            fail('A type is named as a name is and takes none of the built-in names', type?.name);
        }

        const fields = Object.entries(type.fields ?? {});

        if (fields.length === 0) {
            fail('A structured type declares at least one field', type.name);
        }

        for (const [name, text] of fields) {
            if (!Names.isName(name) || !DomqlModule.#isTypeText(text)) {
                fail(`The field '${name}' is not a name with a type`, type.name);
            }
        }

        return structuredClone(type);
    }

    static #checkEvent(event, fail) {
        if (typeof event?.name !== 'string' || !/^[A-Za-z][A-Za-z0-9:-]*$/.test(event.name) || !DomqlModule.#isTypeText(event.payload)) {
            fail('An event declares the name of the browser event and the type of its occurrences', event?.name);
        }

        return structuredClone(event);
    }

    static #checkPredicate(predicate, fail) {
        const name = predicate?.name;

        if (!VERBS.includes(predicate?.verb) || typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9.]*$/.test(name)) {
            fail('A predicate declares the verb, is or has, and its name', name);
        }

        DomqlModule.#checkOn(predicate, name, fail);
        DomqlModule.#checkObservation(predicate, name, fail);

        return structuredClone(predicate);
    }

    static #checkFeature(feature, fail) {
        if (typeof feature !== 'string' || !/^[A-Za-z][A-Za-z0-9-]*$/.test(feature)) {
            fail('A feature is named as a name is', String(feature));
        }

        return feature;
    }

    static #checkOn(declaration, name, fail) {
        const on = Array.isArray(declaration.on) ? declaration.on : [declaration.on];

        if (on.length === 0 || on.some(text => text !== 'any' && !DomqlModule.#isTypeText(text))) {
            fail('It declares the types it applies to', name);
        }
    }

    static #checkObservation(declaration, name, fail) {
        if (!CHANGES.includes(declaration.changes) || !READS.includes(declaration.reads)) {
            fail(`It declares how it changes, one of ${CHANGES.join(', ')}, and how it reads, one of ${READS.join(', ')}`, name);
        }

        if (declaration.changes === 'partly-observable' && (typeof declaration.misses !== 'string' || declaration.misses === '')) {
            fail('A partly observable member states the changes it misses', name);
        }
    }

    static #checkDeclaration(declaration, fail) {
        const name = declaration?.name;

        if (!Names.isName(name) || !KINDS.includes(declaration.kind)) {
            fail(`A declaration is named as a name is and is one of ${KINDS.join(', ')}`, String(name));
        }

        if (!/^[A-Za-z][A-Za-z0-9]*$/.test(declaration.builder ?? '') || !/^[A-Za-z][A-Za-z0-9]*$/.test(declaration.function ?? '')) {
            fail('It names its builder spelling and its function, each as an identifier', name);
        }

        DomqlModule.#checkOn(declaration, name, fail);
        DomqlModule.#checkObservation(declaration, name, fail);

        if (!DomqlModule.#isTypeText(declaration.result)) {
            fail('It declares the type of its result', name);
        }

        const seen = new Set();
        let hasOptional = false;

        for (const parameter of declaration.parameters ?? []) {
            DomqlModule.#checkParameter(parameter, name, fail);

            if (seen.has(parameter.name)) {
                fail(`The parameter '${parameter.name}' is declared twice`, name);
            }

            seen.add(parameter.name);

            if (!parameter.required) {
                hasOptional = true;
            } else if (hasOptional) {
                fail(`The required parameter '${parameter.name}' follows an optional one`, name);
            }
        }

        return structuredClone({ parameters: [], ...declaration });
    }

    static #checkParameter(parameter, declaration, fail) {
        if (!Names.isName(parameter?.name) || !PARAMETER_KINDS.includes(parameter.kind) || !NULLS.includes(parameter.nulls) || typeof parameter.required !== 'boolean') {
            fail('A parameter declares its name, its kind, whether it is required and how it handles null', declaration);
        }

        if (!DomqlModule.#isTypeText(parameter.type)) {
            fail(`The parameter '${parameter.name}' declares a type`, declaration);
        }

        if (parameter.required && 'default' in parameter) {
            fail(`The required parameter '${parameter.name}' declares no default`, declaration);
        }

        if (parameter.kind === 'expression' && parameter.context !== 'item') {
            fail(`The expression parameter '${parameter.name}' declares its evaluation context, item`, declaration);
        }

        if (parameter.fixed === true && !SELECTS.includes(parameter.selects)) {
            fail(`The fixed parameter '${parameter.name}' declares what it selects, one of ${SELECTS.join(', ')}`, declaration);
        }
    }
}
