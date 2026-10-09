/**
 * ModuleRegistry — the declarations of every module registered for a document, which requests resolve against
 */

import { DomqlError } from './DomqlError.mjs';
import { Type } from './Type.mjs';

export class ModuleRegistry {
    /** @type {Map<string, import('./DomqlModule.mjs').DomqlModule>} */
    #modules = new Map();

    /** @type {Map<string, object[]>} */
    #members = new Map();

    /** @type {Map<string, object>} */
    #types = new Map();

    /** @type {Map<string, object>} */
    #events = new Map();

    /** @type {Map<string, object>} */
    #predicates = new Map();

    /** @type {Set<string>} */
    #features = new Set();

    /** @type {Map<string, object>} */
    #observationTypes = new Map();

    /** @type {Map<object, string>} */
    #owners = new Map();

    /** @param {import('./DomqlModule.mjs').DomqlModule[]} modules The modules registered at the start. */
    constructor(modules = []) {
        modules.forEach(module => this.registerModule(module));
    }

    /** The number of modules registered, which changes whenever the vocabulary does. */
    get revision() {
        return this.#modules.size;
    }

    /** The modules registered, by name. */
    get modules() {
        return [...this.#modules.keys()];
    }

    /** Registers a module's declarations, refusing a module whose names are taken or which declares outside its namespace. */
    registerModule(module) {
        const fail = (message, declaration) => { throw DomqlError.module(message, declaration === undefined ? { module: module.name } : { module: module.name, declaration }); };

        if (this.#modules.has(module.name)) {
            fail('A module is registered once, and this name is taken');
        }

        const ownTypes = new Set(module.types.map(type => type.name));

        for (const type of module.types) {
            if (this.#types.has(type.name)) {
                fail(`The type '${type.name}' is declared already`, type.name);
            }
        }

        for (const event of module.eventTypes) {
            if (this.#events.has(event.name)) {
                fail(`The event '${event.name}' is declared already`, event.name);
            }
        }

        for (const predicate of module.predicates) {
            if (this.#predicates.has(ModuleRegistry.#predicateKey(predicate.verb, predicate.name))) {
                fail(`The predicate '${predicate.verb} ${predicate.name}' is declared already`, predicate.name);
            }
        }

        for (const type of module.observationTypes) {
            if (this.#observationTypes.has(type.name)) {
                fail(`The observation type '${type.name}' is declared already`, type.name);
            }
        }

        const types = new Map([...this.#observationTypes, ...module.observationTypes.map(type => [type.name, type])]);

        for (const declaration of [...module.members, ...module.predicates]) {
            ModuleRegistry.#validateObservations(declaration, types, fail);
        }

        module.members.forEach((declaration, index) => {
            this.#checkNamespace(module, declaration, ownTypes, fail);
            this.#checkCollision(declaration, [...this.getMembers(declaration.name), ...module.members.slice(0, index).filter(other => other.name === declaration.name)], fail);
        });

        this.#modules.set(module.name, module);

        for (const type of module.types) {
            this.#types.set(type.name, type);
        }

        for (const event of module.eventTypes) {
            this.#events.set(event.name, event);
        }

        for (const predicate of module.predicates) {
            this.#predicates.set(ModuleRegistry.#predicateKey(predicate.verb, predicate.name), predicate);
            this.#owners.set(predicate, module.name);
        }

        module.features.forEach(feature => this.#features.add(feature));

        for (const type of module.observationTypes) {
            this.#observationTypes.set(type.name, type);
            this.#owners.set(type, module.name);
        }

        for (const declaration of module.members) {
            this.#members.set(declaration.name, [...(this.#members.get(declaration.name) ?? []), declaration]);
            this.#owners.set(declaration, module.name);
        }

        return this;
    }

    /** The declarations named so, across every module. */
    getMembers(name) {
        return this.#members.get(name) ?? [];
    }

    /** The structured type declared so, or undefined. */
    getType(name) {
        return this.#types.get(name);
    }

    /** The event type declared so, or undefined. */
    getEvent(name) {
        return this.#events.get(name);
    }

    /** The predicate the verb reads under the name, or undefined. */
    getPredicate(verb, name) {
        return this.#predicates.get(ModuleRegistry.#predicateKey(verb, name));
    }

    /** Whether a module declared the feature. */
    hasFeature(name) {
        return this.#features.has(name);
    }

    /** The type of observation declared so, or undefined. */
    getObservationType(name) {
        return this.#observationTypes.get(name);
    }

    /** The names a verb reads, for a message that lists them. */
    getPredicateNames(verb) {
        return [...this.#predicates.values()].filter(predicate => predicate.verb === verb).map(predicate => predicate.name);
    }

    /** The name of the module that declared the member or the predicate. */
    getOwner(declaration) {
        return this.#owners.get(declaration);
    }

    /** The function that carries out the member or answers the predicate, or undefined where its module supplies none. */
    getFunction(declaration) {
        return this.#modules.get(this.#owners.get(declaration))?.functions?.[declaration.function];
    }

    static #predicateKey(verb, name) {
        return `${verb} ${name}`;
    }

    /** A module outside the built-in module adds members to its own types, and a single member named for itself to any other. */
    #checkNamespace(module, declaration, ownTypes, fail) {
        if (module.isBuiltIn) {
            return;
        }

        const on = Array.isArray(declaration.on) ? declaration.on : [declaration.on];
        const isOwn = on.every(text => ownTypes.has(ModuleRegistry.#rootName(text)));

        if (!isOwn && declaration.name !== module.name) {
            fail(`A member outside its module's own types is named for the module, '${module.name}'`, declaration.name);
        }
    }

    /** Refuses an observation of a type no module declares, and a member that reads maintained values without a maintained observation, or any other that has one. */
    static #validateObservations(declaration, types, fail) {
        let hasMaintained = false;

        for (const observation of declaration.observations) {
            const type = types.get(observation.type);

            if (type === undefined) {
                fail(`The observation type '${observation.type}' is declared by no module`, declaration.name);
            }

            hasMaintained ||= type.contract === 'maintained';
        }

        if ((declaration.reads === 'maintained') !== hasMaintained) {
            fail(declaration.reads === 'maintained' ? 'It reads maintained values, so it names a maintained observation' : 'It names a maintained observation, so it reads maintained values', declaration.name);
        }
    }

    /** Refuses a member a registered member of its name already answers on one of the same receivers. */
    #checkCollision(declaration, others, fail) {
        for (const other of others) {
            for (const mine of Array.isArray(declaration.on) ? declaration.on : [declaration.on]) {
                for (const theirs of Array.isArray(other.on) ? other.on : [other.on]) {
                    if (ModuleRegistry.#overlap(mine, theirs)) {
                        fail(`'${declaration.name}' is declared already for ${theirs}`, declaration.name);
                    }
                }
            }
        }
    }

    static #rootName(text) {
        return Type.parse(text)?.name ?? text;
    }

    static #overlap(first, second) {
        if (first === 'any' || second === 'any') {
            return true;
        }

        return Type.unify(Type.parse(first), Type.parse(second), new Map()) || Type.unify(Type.parse(second), Type.parse(first), new Map());
    }
}
