/**
 * DomqlModule — a vocabulary's members as data, and the functions that carry them out
 */

import { DomqlError } from './DomqlError.mjs';
import { Names } from './Names.mjs';
import { Type } from './Type.mjs';

const MEMBER_KINDS = ['property', 'operation', 'source', 'action', 'behavior'];

/** How a member changes: the specification's categories, and `derived` for a contract that comes from the member, predicate or expression a member selects or evaluates. */
const OBSERVATION_CATEGORIES = ['constant', 'observable', 'partly-observable', 'unobserved', 'derived'];

/** How a member reads: the specification's modes, and `derived` for a contract that comes from the member, predicate or expression a member selects or evaluates. */
const READING_MODES = ['fresh', 'maintained', 'captured', 'derived'];
const NULL_POLICIES = ['propagate', 'accept'];
const SELECTION_KINDS = ['member', 'predicate', 'occurrence', 'feature'];
const PARAMETER_KINDS = ['value', 'expression'];
const PREDICATE_VERBS = ['is', 'has'];

/** What a fixed parameter can select that carries out the member itself: the predicate or the member its name resolves to. */
const DELEGATED_SELECTION_KINDS = ['member', 'predicate'];

/** The names of the types DOMQL itself defines, which a module cannot declare again. */
const RESERVED_TYPE_NAMES = new Set(['number', 'string', 'boolean', 'element', 'window', 'document', 'list', 'occurrence', 'null']);

/** The name that identifies the built-in module, whose members the specification calls the core vocabulary and which stand without a namespace. */
const BUILTIN_MODULE_NAME = 'core';

export class DomqlModule {
    #name;
    #members;
    #types;
    #eventTypes;
    #predicates;
    #features;
    #functions;

    /** Proves a module is the built-in one, which only its own factory can. */
    static #builtInToken = Symbol('built-in');

    /**
     * @param {string} name The module's name, which names its namespace.
     * @param {object} contents What the module declares.
     * @param {object[]} [contents.members] The properties, operations, sources, actions and behaviors it adds.
     * @param {object[]} [contents.types] The structured types it declares, each with its fields.
     * @param {object[]} [contents.eventTypes] The event types it declares, each with the type of its occurrences.
     * @param {object[]} [contents.predicates] The predicates `is` and `has` read.
     * @param {string[]} [contents.features] The features `supports` names.
     * @param {Record<string, Function> | null} [functions] The functions that carry the members out, by the key each member names.
     * @param {symbol} [builtInToken] Held by the built-in module alone.
     */
    constructor(name, contents = {}, functions = null, builtInToken = undefined) {
        if (!Names.isName(name)) {
            throw DomqlError.module('A module is named as a name is', { module: String(name) });
        }

        if (name === BUILTIN_MODULE_NAME && builtInToken !== DomqlModule.#builtInToken) {
            throw DomqlError.module(`'${BUILTIN_MODULE_NAME}' is the built-in module's identity, which no other module takes`, { module: name });
        }

        const { members = [], types = [], eventTypes = [], predicates = [], features = [] } = contents;
        const fail = (message, declaration) => { throw DomqlError.module(message, declaration === undefined ? { module: name } : { module: name, declaration }); };

        this.#name = name;
        this.#types = DomqlModule.#freezeItems(types.map(type => DomqlModule.#validateTypeDeclaration(type, fail)));
        this.#members = DomqlModule.#freezeItems(members.map(member => DomqlModule.#validateMember(member, fail)));
        this.#eventTypes = DomqlModule.#freezeItems(eventTypes.map(eventType => DomqlModule.#validateEventType(eventType, fail)));
        this.#predicates = DomqlModule.#freezeItems(predicates.map(predicate => DomqlModule.#validatePredicate(predicate, fail)));
        this.#features = DomqlModule.#freezeItems(features.map(feature => DomqlModule.#validateFeatureName(feature, fail)));

        if (functions !== null) {
            for (const declaration of [...this.#members, ...this.#predicates]) {
                if (declaration.function !== undefined && typeof functions[declaration.function] !== 'function') {
                    fail(`The function '${declaration.function}' it names is not among the module's functions`, declaration.name);
                }
            }
        }

        this.#functions = functions;
    }

    /** The built-in module, which declares the core vocabulary. */
    static createBuiltIn(contents, functions = null) {
        return new DomqlModule(BUILTIN_MODULE_NAME, contents, functions, DomqlModule.#builtInToken);
    }

    /** Whether the module is the built-in one. */
    get isBuiltIn() {
        return this.#name === BUILTIN_MODULE_NAME;
    }

    /** The module's name. */
    get name() {
        return this.#name;
    }

    /** The members the module adds. */
    get members() {
        return this.#members;
    }

    /** The structured types the module declares. */
    get types() {
        return this.#types;
    }

    /** The event types the module declares. */
    get eventTypes() {
        return this.#eventTypes;
    }

    /** The predicates the module declares. */
    get predicates() {
        return this.#predicates;
    }

    /** The features the module declares. */
    get features() {
        return this.#features;
    }

    /** The functions that carry the members out, or null for a module that declares and does not yet implement. */
    get functions() {
        return this.#functions;
    }

    static #freezeItems(items) {
        return Object.freeze(items.map(item => DomqlModule.#deepFreeze(item)));
    }

    static #deepFreeze(value) {
        if (value !== null && typeof value === 'object') {
            Object.values(value).forEach(item => DomqlModule.#deepFreeze(item));
            Object.freeze(value);
        }

        return value;
    }

    static #isIdentifier(text) {
        return typeof text === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(text);
    }

    static #isTypeExpression(typeExpression) {
        return Type.parse(typeExpression) !== null;
    }

    static #validateTypeDeclaration(type, fail) {
        if (!Names.isName(type?.name) || RESERVED_TYPE_NAMES.has(type.name)) {
            fail('A type is named as a name is and takes none of the built-in names', type?.name);
        }

        const fields = Object.entries(type.fields ?? {});

        if (fields.length === 0) {
            fail('A structured type declares at least one field', type.name);
        }

        for (const [name, typeExpression] of fields) {
            if (!Names.isName(name) || !DomqlModule.#isTypeExpression(typeExpression)) {
                fail(`The field '${name}' is not a name with a type`, type.name);
            }
        }

        return structuredClone(type);
    }

    static #validateEventType(eventType, fail) {
        if (typeof eventType?.name !== 'string' || !/^[A-Za-z][A-Za-z0-9:-]*$/.test(eventType.name) || !DomqlModule.#isTypeExpression(eventType.payload)) {
            fail('An event type declares the name of the browser event and the type of its occurrences', eventType?.name);
        }

        return structuredClone(eventType);
    }

    static #validatePredicate(predicate, fail) {
        const name = predicate?.name;

        if (!PREDICATE_VERBS.includes(predicate?.verb) || typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9.]*$/.test(name)) {
            fail('A predicate declares the verb, is or has, and its name', name);
        }

        if (!DomqlModule.#isIdentifier(predicate.function)) {
            fail('It names the function that answers it, as an identifier', name);
        }

        DomqlModule.#validateReceiverTypes(predicate, name, fail);
        DomqlModule.#validateObservation(predicate, name, fail);

        return structuredClone(predicate);
    }

    static #validateFeatureName(feature, fail) {
        if (typeof feature !== 'string' || !/^[A-Za-z][A-Za-z0-9-]*$/.test(feature)) {
            fail('A feature is named as a name is', String(feature));
        }

        return feature;
    }

    static #validateReceiverTypes(declaration, name, fail) {
        const receiverTypes = Array.isArray(declaration.on) ? declaration.on : [declaration.on];

        if (receiverTypes.length === 0 || receiverTypes.some(typeExpression => typeExpression !== 'any' && !DomqlModule.#isTypeExpression(typeExpression))) {
            fail('It declares the types it applies to', name);
        }
    }

    /** Validates both how a declaration changes and how it reads. */
    static #validateObservation(declaration, name, fail) {
        if (!OBSERVATION_CATEGORIES.includes(declaration.changes) || !READING_MODES.includes(declaration.reads)) {
            fail(`It declares how it changes, one of ${OBSERVATION_CATEGORIES.join(', ')}, and how it reads, one of ${READING_MODES.join(', ')}`, name);
        }

        if (declaration.changes === 'partly-observable' && (typeof declaration.misses !== 'string' || declaration.misses === '')) {
            fail('A partly observable member states the changes it misses', name);
        }
    }

    static #validateMember(member, fail) {
        const name = member?.name;

        if (!Names.isName(name) || !MEMBER_KINDS.includes(member.kind)) {
            fail(`A member is named as a name is and is one of ${MEMBER_KINDS.join(', ')}`, String(name));
        }

        const delegatesEvaluation = (member.parameters ?? []).some(parameter => parameter?.fixed === true && DELEGATED_SELECTION_KINDS.includes(parameter.selects));

        if (!DomqlModule.#isIdentifier(member.builder) || (delegatesEvaluation ? member.function !== undefined : !DomqlModule.#isIdentifier(member.function))) {
            fail(delegatesEvaluation ? 'It names its builder spelling as an identifier and no function, since what its name resolves to carries it out' : 'It names its builder spelling and its function, each as an identifier', name);
        }

        DomqlModule.#validateReceiverTypes(member, name, fail);
        DomqlModule.#validateObservation(member, name, fail);

        if (!DomqlModule.#isTypeExpression(member.result)) {
            fail('It declares the type of its result', name);
        }

        const parameterNames = new Set();
        let hasOptional = false;

        for (const parameter of member.parameters ?? []) {
            DomqlModule.#validateParameter(parameter, name, fail);

            if (parameterNames.has(parameter.name)) {
                fail(`The parameter '${parameter.name}' is declared twice`, name);
            }

            parameterNames.add(parameter.name);

            if (!parameter.required) {
                hasOptional = true;
            } else if (hasOptional) {
                fail(`The required parameter '${parameter.name}' follows an optional one`, name);
            }
        }

        return structuredClone({ parameters: [], ...member });
    }

    static #validateParameter(parameter, declaration, fail) {
        if (!Names.isName(parameter?.name) || !PARAMETER_KINDS.includes(parameter.kind) || !NULL_POLICIES.includes(parameter.nulls) || typeof parameter.required !== 'boolean') {
            fail('A parameter declares its name, its kind, whether it is required and how it handles null', declaration);
        }

        if (!DomqlModule.#isTypeExpression(parameter.type)) {
            fail(`The parameter '${parameter.name}' declares a type`, declaration);
        }

        if (parameter.required && 'default' in parameter) {
            fail(`The required parameter '${parameter.name}' declares no default`, declaration);
        }

        if (parameter.kind === 'expression' && parameter.context !== 'item') {
            fail(`The expression parameter '${parameter.name}' declares its evaluation context, item`, declaration);
        }

        if (parameter.fixed === true && !SELECTION_KINDS.includes(parameter.selects)) {
            fail(`The fixed parameter '${parameter.name}' declares what it selects, one of ${SELECTION_KINDS.join(', ')}`, declaration);
        }
    }
}
