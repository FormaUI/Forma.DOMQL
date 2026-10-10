/**
 * QueryEvaluator — reads a resolved query once, answering detached data
 */

import { DomqlError } from '../language/DomqlError.mjs';
import { Names } from '../language/Names.mjs';
import { Type } from '../language/Type.mjs';
import { QueryEvaluation } from './QueryEvaluation.mjs';

/** @typedef {{ window: Window, document: Document }} Environment */

/** What a predicate answers. */
const BOOLEAN = Type.named('boolean');

export class QueryEvaluator {
    #moduleRegistry;
    #resolvedDefinition;
    #parameterBindings;
    #environment;
    #locations;

    /** What the evaluation in progress records, or null where none does. @type {{ observations: import('./Observations.mjs').Observations, onChange: () => void, holdsAll: boolean, dependencies: object[], sessions: object[], unheld: object[], isPending: boolean } | null} */
    #recording = null;

    /**
     * @param {import('../language/vocabulary/ModuleRegistry.mjs').ModuleRegistry} moduleRegistry The vocabulary the request was resolved against.
     * @param {import('../language/ResolvedDefinition.mjs').ResolvedDefinition} resolvedDefinition The resolved definition to read.
     * @param {import('../language/ParameterBindings.mjs').ParameterBindings} parameterBindings What the request's parameters are bound to.
     * @param {Environment} environment The window and the document the roots stand for.
     * @param {import('../language/TextLocations.mjs').TextLocations | null} locations Where in a text each part of the definition came from.
     */
    constructor(moduleRegistry, resolvedDefinition, parameterBindings, environment, locations) {
        this.#moduleRegistry = moduleRegistry;
        this.#resolvedDefinition = resolvedDefinition;
        this.#parameterBindings = parameterBindings;
        this.#environment = environment;
        this.#locations = locations;
    }

    /** The result the query reads once: immutable data holding no reference to the document. A member maintained by an observation fails it, since its first sample cannot arrive during a synchronous read. */
    read() {
        return this.#result();
    }

    /**
     * Evaluates the query and records what the evaluation depended on, holding each dependency's observations through sessions that call `onChange` when something may have changed.
     * A maintained member whose first sample has not arrived is pending and answers null, and the evaluation is pending with it. A failure ends the evaluation without throwing, keeping the dependencies it recorded before failing and answering nothing.
     * The caller disposes the evaluation, which it does after it has the next one, so an observation both need keeps running.
     * The observations that keep a maintained member's sample are always held. The others are held where the caller keeps the result current, and otherwise only while the evaluation is pending, since a result that is complete needs nothing more observed.
     * @param {object} recording Where the dependencies are observed.
     * @param {import('./Observations.mjs').Observations} recording.observations The observations of the window the query is evaluated in.
     * @param {() => void} recording.onChange Called, synchronously, when something the result depends on may have changed.
     * @param {boolean} [recording.holdsAll] Whether every dependency's observation is held, as a watch holds them, rather than those a pending evaluation waits on.
     */
    evaluate({ observations, onChange, holdsAll = false }) {
        const recording = { observations, onChange, holdsAll, dependencies: [], sessions: [], unheld: [], isPending: false };
        let value;
        let error = null;

        this.#recording = recording;

        try {
            value = this.#result();
        } catch (failure) {
            // A member read through a pending one saw null where a sample will be, so its failure says nothing until the sample arrives.
            error = recording.isPending ? null : failure;
        } finally {
            this.#recording = null;
        }

        if (recording.isPending) {
            try {
                // The pending result waits on whatever changes the evaluation depended on, so it holds them now.
                for (const request of recording.unheld) {
                    recording.sessions.push(observations.acquire(request, onChange));
                }
            } catch (failure) {
                error = failure;
            }
        }

        return new QueryEvaluation({ value, isPending: recording.isPending, dependencies: recording.dependencies, sessions: recording.sessions, error });
    }

    #result() {
        if (this.#resolvedDefinition.kind !== 'query') {
            this.#fail(`A ${this.#resolvedDefinition.kind} request is not read`, '/query');
        }

        return QueryEvaluator.#detach(this.#evaluate(this.#resolvedDefinition.definition.query, '/query', null));
    }

    #evaluate(node, pointer, current) {
        switch (node.kind) {
            case 'literal':
                return node.value;
            case 'parameter':
                return this.#parameter(node);
            case 'member':
                return this.#member(node, pointer, current);
            case 'predicate':
                return this.#test(node, pointer, current);
            default:
                return this.#shape(node, pointer, current);
        }
    }

    /** Tests the subject, evaluated once, against the predicates the test reaches; a test of null is null. */
    #test(node, pointer, current) {
        const subject = node.target === undefined ? current : this.#evaluate(node.target, `${pointer}/target`, current);

        return subject === null ? null : this.#holds(node.test, `${pointer}/test`, subject);
    }

    /** Whether the names hold of the subject: an and stops at the first that does not, an or at the first that does, so a predicate the result does not need is never read. */
    #holds(node, pointer, subject) {
        switch (node.kind) {
            case 'and':
                return node.operands.every((operand, index) => this.#holds(operand, `${pointer}/operands/${index}`, subject) === true);
            case 'or':
                return node.operands.some((operand, index) => this.#holds(operand, `${pointer}/operands/${index}`, subject) === true);
            default:
                return this.#invoke(this.#resolvedDefinition.getResolution(pointer).predicate, subject, {}, BOOLEAN, pointer);
        }
    }

    #parameter(node) {
        switch (node.name) {
            case 'window':
                return this.#environment.window;
            case 'document':
                return this.#environment.document;
            default:
                return this.#parameterBindings.get(node.name);
        }
    }

    #member(node, pointer, current) {
        const receiver = node.target === undefined ? current : this.#evaluate(node.target, `${pointer}/target`, current);

        if (receiver === null) {
            return null;
        }

        const resolution = this.#resolvedDefinition.getResolution(pointer);

        if (resolution.kind === 'field') {
            return receiver[node.name] ?? null;
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

    /** Carries out a declaration's function, or a predicate's, checking that its result is of the declared type. */
    #invoke(declaration, receiver, args, type, pointer) {
        const implementation = this.#moduleRegistry.getFunction(declaration);

        if (implementation === undefined) {
            this.#fail(`The module '${this.#moduleRegistry.getOwner(declaration)}' supplies no function for '${declaration.name}'`, pointer);
        }

        const samples = this.#observe(declaration, receiver, args, pointer);

        if (samples === null) {
            return null;
        }

        let value;

        try {
            value = implementation(receiver, args, this.#environment, samples);
        } catch (error) {
            throw DomqlError.evaluation(`The member '${declaration.name}' failed: ${error.message}`, this.#locate(pointer), { cause: error });
        }

        if (!this.#conforms(value, type)) {
            this.#fail(`The member '${declaration.name}' answered ${QueryEvaluator.#describe(value)}, and it declares ${type}`, pointer);
        }

        this.#observeDetached(declaration, receiver, value, pointer);

        return value;
    }

    /**
     * Records what the call depends on and holds its observations, answering the samples of its maintained observations, in the order the declaration names them.
     * Answers null where a sample is still pending, which makes the member answer null and the evaluation pending.
     */
    #observe(declaration, receiver, args, pointer) {
        if (this.#recording === null) {
            if (declaration.reads === 'maintained') {
                this.#fail(`The member '${declaration.name}' is maintained by an observation, and reading it waits for the first sample, which a synchronous evaluation cannot`, pointer);
            }

            return [];
        }

        const { observations, dependencies } = this.#recording;
        const requests = [];
        const samples = [];
        let isPending = false;

        for (const observation of declaration.observations ?? []) {
            const request = observations.resolve(observation, { receiver, args });

            if (request === null) {
                continue;
            }

            requests.push(request);

            const session = this.#hold(request);

            if (session?.contract === 'maintained') {
                const sample = session.sample();

                isPending ||= sample.pending;
                samples.push(sample.value);
            }
        }

        dependencies.push({ member: declaration.name, pointer, observations: requests });

        if (isPending) {
            this.#recording.isPending = true;

            return null;
        }

        return samples;
    }

    /** A member that answered null because its element is detached depends on whether the element is attached, so it is read again when the element returns. */
    #observeDetached(declaration, receiver, value, pointer) {
        if (this.#recording === null || value !== null || receiver?.nodeType !== 1 || receiver.isConnected || this.#moduleRegistry.getObservationType('attachment') === undefined) {
            return;
        }

        const request = this.#recording.observations.resolve({ type: 'attachment', of: 'receiver' }, { receiver, args: {} });

        this.#hold(request);
        this.#recording.dependencies.push({ member: declaration.name, pointer, observations: [request] });
    }

    /** Holds the observation of the request, answering its session, or leaves it unheld where only a pending evaluation needs it and answers null. */
    #hold(request) {
        const { observations, onChange, holdsAll, sessions, unheld } = this.#recording;
        const type = this.#moduleRegistry.getObservationType(request.type);

        if (type !== undefined && type.contract === 'invalidation' && !holdsAll) {
            unheld.push(request);

            return null;
        }

        const session = observations.acquire(request, onChange);

        sessions.push(session);

        return session;
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
                return QueryEvaluator.#isRecord(value) && [...type.fields].every(([name, field]) => this.#conforms(value[name], field));
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
                const structure = this.#moduleRegistry.getType(name);

                return structure !== undefined && QueryEvaluator.#isRecord(value) && Object.entries(structure.fields).every(([field, text]) => this.#conforms(value[field], Type.parse(text)));
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
            return Object.freeze(value.map(item => QueryEvaluator.#detach(item)));
        }

        if (QueryEvaluator.#isRecord(value)) {
            return Object.freeze(Object.fromEntries(Object.entries(value).map(([name, field]) => [name, QueryEvaluator.#detach(field)])));
        }

        return value;
    }
}
