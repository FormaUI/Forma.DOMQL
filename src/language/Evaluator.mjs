/**
 * Evaluator — reads a resolved query once, answering detached data
 */

import { DomqlError } from './DomqlError.mjs';
import { Names } from './Names.mjs';
import { Type } from './Type.mjs';

/** @typedef {{ window: Window, document: Document }} Environment */

export class Evaluator {
    #registry;
    #request;
    #bindings;
    #environment;
    #locations;

    /**
     * @param {import('./ModuleRegistry.mjs').ModuleRegistry} registry The vocabulary the request was resolved against.
     * @param {import('./ResolvedRequest.mjs').ResolvedRequest} request The request to read.
     * @param {import('./Bindings.mjs').Bindings} bindings What the request's parameters are bound to.
     * @param {Environment} environment The window and the document the roots stand for.
     * @param {import('./TextLocations.mjs').TextLocations | null} locations Where in a text each part of the definition came from.
     */
    constructor(registry, request, bindings, environment, locations) {
        this.#registry = registry;
        this.#request = request;
        this.#bindings = bindings;
        this.#environment = environment;
        this.#locations = locations;
    }

    /** The answer the query reads: immutable data holding no reference to the document. */
    read() {
        if (this.#request.kind !== 'query') {
            this.#fail(`A ${this.#request.kind} request is not read`, '/query');
        }

        return Evaluator.#detach(this.#evaluate(this.#request.definition.query, '/query', null));
    }

    #evaluate(node, pointer, current) {
        switch (node.kind) {
            case 'literal':
                return node.value;
            case 'parameter':
                return this.#parameter(node);
            case 'member':
                return this.#member(node, pointer, current);
            default:
                return this.#shape(node, pointer, current);
        }
    }

    #parameter(node) {
        switch (node.name) {
            case 'window':
                return this.#environment.window;
            case 'document':
                return this.#environment.document;
            default:
                return this.#bindings.get(node.name);
        }
    }

    #member(node, pointer, current) {
        const receiver = node.target === undefined ? current : this.#evaluate(node.target, `${pointer}/target`, current);

        if (receiver === null) {
            return null;
        }

        const resolution = this.#request.getResolution(pointer);

        if (resolution.kind === 'field') {
            return receiver[node.name] ?? null;
        }

        if (resolution.predicate !== undefined) {
            return this.#invoke(resolution.predicate, receiver, {}, resolution.type, pointer);
        }

        if (resolution.steps !== undefined) {
            return this.#follow(resolution.steps, receiver, pointer);
        }

        const args = this.#arguments(resolution, current);

        return args === null ? null : this.#invoke(resolution.declaration, receiver, args, resolution.type, pointer);
    }

    /** The arguments by parameter name, or null where a null argument makes the call answer null. */
    #arguments(resolution, current) {
        const args = {};

        for (const argument of resolution.arguments) {
            const { parameter } = argument;

            if (argument.isDefault || parameter.fixed) {
                args[parameter.name] = argument.isDefault ? parameter.default : argument.value;
            } else if (parameter.kind === 'expression') {
                args[parameter.name] = item => this.#evaluate(argument.node, argument.pointer, item);
            } else {
                const value = this.#evaluate(argument.node, argument.pointer, current);

                if (value === null && parameter.nulls === 'propagate') {
                    return null;
                }

                args[parameter.name] = value;
            }
        }

        return args;
    }

    /** Follows the path a get names, each step from the value before it, answering null from the first null. */
    #follow(steps, receiver, pointer) {
        let value = receiver;

        for (const step of steps) {
            if (step.kind === 'field') {
                value = value[step.name] ?? null;
            } else {
                const args = Object.fromEntries(step.declaration.parameters.map(parameter => [parameter.name, parameter.default]));

                value = this.#invoke(step.declaration, value, args, step.type, pointer);
            }

            if (value === null) {
                return null;
            }
        }

        return value;
    }

    /** Carries out a declaration's function, or a predicate's, checking that its answer is of the declared type. */
    #invoke(declaration, receiver, args, type, pointer) {
        const implementation = this.#registry.getFunction(declaration);

        if (implementation === undefined) {
            this.#fail(`The module '${this.#registry.getOwner(declaration)}' supplies no function for '${declaration.name}'`, pointer);
        }

        let value;

        try {
            value = implementation(receiver, args, this.#environment);
        } catch (error) {
            throw DomqlError.evaluation(`The member '${declaration.name}' failed: ${error.message}`, this.#locate(pointer), { cause: error });
        }

        if (!this.#conforms(value, type)) {
            this.#fail(`The member '${declaration.name}' answered ${Evaluator.#describe(value)}, and it declares ${type}`, pointer);
        }

        return value;
    }

    #shape(node, pointer, current) {
        const hasTarget = node.target !== undefined;
        const target = hasTarget ? this.#evaluate(node.target, `${pointer}/target`, current) : current;
        const apply = item => item === null && hasTarget
            ? null
            : Object.fromEntries(node.fields.map((field, index) => [field.name ?? Names.inferField(field.value), this.#evaluate(field.value, `${pointer}/fields/${index}/value`, item)]));

        return hasTarget && Array.isArray(target) ? target.map(apply) : apply(target);
    }

    /** Whether the value is one the type admits. */
    #conforms(value, type) {
        if (value === undefined) {
            return false;
        }

        if (value === null) {
            return type.isNullable;
        }

        switch (type.kind) {
            case 'variable':
                return true;
            case 'list':
                return Array.isArray(value) && value.every(item => this.#conforms(item, type.item));
            case 'shape':
                return Evaluator.#isRecord(value) && [...type.fields].every(([name, field]) => this.#conforms(value[name], field));
            default:
                return this.#conformsNamed(value, type.name);
        }
    }

    #conformsNamed(value, name) {
        switch (name) {
            case 'number':
                return Number.isFinite(value);
            case 'string':
                return typeof value === 'string';
            case 'boolean':
                return typeof value === 'boolean';
            case 'element':
                return value?.nodeType === 1;
            case 'document':
                return value?.nodeType === 9;
            case 'window':
                return value?.window === value;
            default: {
                const structure = this.#registry.getType(name);

                return structure !== undefined && Evaluator.#isRecord(value) && Object.entries(structure.fields).every(([field, text]) => this.#conforms(value[field], Type.parse(text)));
            }
        }
    }

    #fail(message, pointer) {
        throw DomqlError.evaluation(message, this.#locate(pointer));
    }

    #locate(pointer) {
        return this.#locations?.locate(pointer) ?? { pointer };
    }

    static #isRecord(value) {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    /** What the value is, for a message: nothing, a node, or its data where it has any. */
    static #describe(value) {
        if (value === undefined) {
            return 'nothing';
        }

        if (typeof value?.nodeType === 'number') {
            return value.nodeType === 1 ? 'an element' : 'a node';
        }

        try {
            return JSON.stringify(value) ?? String(value);
        } catch {
            return Object.prototype.toString.call(value);
        }
    }

    /** A copy of the data sharing no structure with the original, frozen. */
    static #detach(value) {
        if (Array.isArray(value)) {
            return Object.freeze(value.map(item => Evaluator.#detach(item)));
        }

        if (Evaluator.#isRecord(value)) {
            return Object.freeze(Object.fromEntries(Object.entries(value).map(([name, field]) => [name, Evaluator.#detach(field)])));
        }

        return value;
    }
}
