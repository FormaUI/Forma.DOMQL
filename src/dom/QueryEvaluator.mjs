/**
 * QueryEvaluator — evaluates a resolved request, answering detached data: a query as it reads now, and a subscription's projection of each occurrence its source delivers
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

    /** The element each item of a list a shape projected came from, by the list it produced, for the evaluation in progress. @type {WeakMap<unknown[], (Element | null)[]>} */
    #elementsOf = new WeakMap();

    /** What the evaluation in progress records, or null where none does. @type {{ observations: import('./Observations.mjs').Observations, onChange: () => void, holdsAll: boolean, dependencies: object[], sessions: object[], unheld: object[], isPending: boolean } | null} */
    #recording = null;

    /** The identities of the value `#detach` detached last. @type {import('../snapshots/SnapshotPatcher.mjs').Identities} */
    #detachedIdentities = null;

    /** The value that stands for the member the request ends in while its projection is evaluated, an occurrence or an action's result, and the member's node, or null outside a projection. @type {{ node: object, value: unknown } | null} */
    #occurrence = null;

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
        return this.#result().value;
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
        return this.#record({ observations, onChange, holdsAll, waits: true }, () => this.#result());
    }

    /**
     * Resolves the occurrence source the subscription ends in into what starts it: the source's name, the function that carries it out, the receiver and arguments it is called with and the environment, how each occurrence it delivers is captured, and where it stands, for a failure to name.
     * The receiver and arguments are evaluated once, now; where one of them is null there is nothing to listen to, and the answer is null.
     * `capture` answers an occurrence as the fields its type declares, read as it is called: a field the occurrence does not carry as a value its type admits is null where the type is nullable, and fails the capture where it is not; an occurrence of a type with no fields is taken whole, where it is of its type.
     * @returns {{ name: string, start: Function, capture: (occurrence: unknown) => unknown, receiver: unknown, args: Record<string, unknown>, environment: Environment, location: object } | null}
     */
    resolveSource() {
        const call = this.#resolveCall('subscription', 'subscribed to');

        return call.args === null ? null : { name: call.name, start: call.implementation, capture: occurrence => this.#capture(occurrence, call.node), receiver: call.receiver, args: call.args, environment: call.environment, location: call.location };
    }

    /**
     * Resolves the action the request ends in into what runs it: the action's name, the function that carries it out, the receiver and arguments it is called with and the environment, and where it stands, for a failure to name.
     * The receiver and arguments are evaluated once, now, as a read evaluates them; where one of them is null the action is not run, and the answer is null.
     * @returns {{ name: string, run: Function, receiver: unknown, args: Record<string, unknown>, environment: Environment, location: object } | null}
     */
    resolveAction() {
        const call = this.#resolveCall('action', 'run');

        return call.args === null ? null : { name: call.name, run: call.implementation, receiver: call.receiver, args: call.args, environment: call.environment, location: call.location };
    }

    /**
     * Resolves the behavior the request ends in into what activates it: the behavior's declaration and name, the function that carries it out, the receiver and arguments it is called with and the environment, and where it stands, for a failure to name.
     * The receiver and arguments are evaluated now, as a read evaluates them; where one of them is null there is nothing to activate, and the arguments are null.
     * @returns {{ declaration: object, name: string, activate: Function, receiver: unknown, args: Record<string, unknown> | null, environment: Environment, location: object }}
     */
    resolveBehavior() {
        const call = this.#resolveCall('behavior', 'activated');

        return { declaration: call.declaration, name: call.name, activate: call.implementation, receiver: call.receiver, args: call.args, environment: call.environment, location: call.location };
    }

    /**
     * The result of an action, checked against the type the action declares and shaped by the shape that follows it, if one does: an immutable snapshot containing no live DOM references.
     * The shape is evaluated as a read evaluates a query, so a member maintained by an observation fails it. A result of another type, or a shape that fails, throws an evaluation error.
     * @param {unknown} result What the action's function answered, or null for an action that was not run, since its receiver or an argument was null.
     * @param {{ wasRun?: boolean }} [run] Whether the action was run, so its result is checked against the type it declares.
     */
    projectResult(result, { wasRun = true } = {}) {
        const { node, pointer } = this.#endNode();
        const { declaration, type } = this.#resolvedDefinition.resolutionOf(node);

        if (wasRun && !this.#conforms(result, type)) {
            this.#fail(`The action '${declaration.name}' answered ${QueryEvaluator.#describe(result)}, and it declares ${type}`, pointer);
        }

        this.#occurrence = { node, value: result };

        try {
            this.#elementsOf = new WeakMap();

            return this.#detachResult(this.#evaluate(this.#resolvedDefinition.definition.query, null)).value;
        } finally {
            this.#occurrence = null;
        }
    }

    /** The member the request ends in, evaluated up to its call: its declaration, the function that carries it out, and its receiver and arguments, which are null where the receiver or an argument is. */
    #resolveCall(kind, use) {
        if (this.#resolvedDefinition.kind !== kind) {
            this.#fail(`A ${this.#resolvedDefinition.kind} request is not ${use}`, '/query');
        }

        const { node, pointer } = this.#endNode();
        const resolution = this.#resolvedDefinition.resolutionOf(node);
        const { declaration } = resolution;
        const receiver = this.#evaluate(node.target, null);
        const args = receiver === null ? null : this.#arguments(resolution, null);

        const implementation = this.#moduleRegistry.getFunction(declaration);

        if (implementation === undefined) {
            this.#fail(`The module '${this.#moduleRegistry.getOwner(declaration)}' supplies no function for '${declaration.name}'`, pointer);
        }

        return { declaration, name: declaration.name, implementation, receiver, args, environment: this.#environment, location: this.#locate(pointer), node };
    }

    /**
     * Evaluates the shape that follows the occurrence source against one occurrence, as its source captured it, and records the observations its maintained members read.
     * A maintained member answers its latest sample, or null while the sample is pending, and is never waited for; the evaluation holds the sessions that keep its samples, so the caller keeps them for the next occurrence and disposes the evaluation once it has the next one. A failure ends the evaluation without throwing.
     * @param {unknown} occurrence The occurrence, as `capture` answered it.
     * @param {object} recording Where the dependencies are observed.
     * @param {import('./Observations.mjs').Observations} recording.observations The observations of the window the subscription listens in.
     */
    project(occurrence, { observations }) {
        return this.#record({ observations, onChange: () => {}, holdsAll: false, waits: false }, () => {
            const { node } = this.#endNode();

            this.#occurrence = { node, value: occurrence };

            try {
                this.#elementsOf = new WeakMap();

                return this.#detachResult(this.#evaluate(this.#resolvedDefinition.definition.query, null));
            } finally {
                this.#occurrence = null;
            }
        });
    }

    /** Runs an evaluation that records what it depends on, answering the evaluation; one that waits holds what a pending result waits on, and lets a failure seen through a pending member pass. */
    #record({ observations, onChange, holdsAll, waits }, produce) {
        const recording = { observations, onChange, holdsAll, dependencies: [], sessions: [], unheld: [], isPending: false };
        let value;
        let identities = null;
        let error = null;

        this.#recording = recording;

        try {
            ({ value, identities } = produce());
        } catch (failure) {
            // A member read through a pending one saw null where a sample will be, so its failure says nothing until the sample arrives.
            error = waits && recording.isPending ? null : failure;
        } finally {
            this.#recording = null;
        }

        if (waits && recording.isPending) {
            try {
                // The pending result waits on whatever changes the evaluation depended on, so it holds them now.
                for (const request of recording.unheld) {
                    recording.sessions.push(observations.acquire(request, onChange));
                }
            } catch (failure) {
                error = failure;
            }
        }

        return new QueryEvaluation({ value, identities, isPending: recording.isPending, dependencies: recording.dependencies, sessions: recording.sessions, error });
    }

    /** The detached result, and the identities of the elements its lists were projected from, which the result itself never holds. */
    #result() {
        if (this.#resolvedDefinition.kind !== 'query') {
            this.#fail(`A ${this.#resolvedDefinition.kind} request is not read`, '/query');
        }

        this.#elementsOf = new WeakMap();

        return this.#detachResult(this.#evaluate(this.#resolvedDefinition.definition.query, null));
    }

    #evaluate(node, current) {
        switch (node.kind) {
            case 'literal':
                return node.value;
            case 'parameter':
                return this.#parameter(node);
            case 'member':
                return this.#member(node, current);
            case 'predicate':
                return this.#test(node, current);
            default:
                return this.#shape(node, current);
        }
    }

    /** Tests the subject, evaluated once, against the predicates the test reaches; a test of null is null. */
    #test(node, current) {
        const subject = node.target === undefined ? current : this.#evaluate(node.target, current);

        return subject === null ? null : this.#holds(node.test, subject);
    }

    /** Whether the names hold of the subject: an and stops at the first that does not, an or at the first that does, so a predicate the result does not need is never read. */
    #holds(node, subject) {
        switch (node.kind) {
            case 'and':
                return node.operands.every(operand => this.#holds(operand, subject) === true);
            case 'or':
                return node.operands.some(operand => this.#holds(operand, subject) === true);
            default:
                return this.#invoke(this.#resolvedDefinition.resolutionOf(node).predicate, subject, {}, BOOLEAN, node);
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

    #member(node, current) {
        // A projection stands the occurrence or the result where its member is, so that member is never read again.
        if (node === this.#occurrence?.node) {
            return this.#occurrence.value;
        }

        const receiver = node.target === undefined ? current : this.#evaluate(node.target, current);

        if (receiver === null) {
            return null;
        }

        const resolution = this.#resolvedDefinition.resolutionOf(node);

        if (resolution.kind === 'field') {
            return receiver[node.name] ?? null;
        }

        if (resolution.steps !== undefined) {
            return this.#follow(resolution.steps, receiver, node);
        }

        const args = this.#arguments(resolution, current);

        return args === null ? null : this.#invoke(resolution.declaration, receiver, args, resolution.type, node);
    }

    /** The arguments by parameter name, or null where a null argument makes the call answer null. */
    #arguments(resolution, current) {
        const args = {};

        for (const argument of resolution.arguments) {
            const { parameter } = argument;

            if (argument.isDefault || parameter.fixed) {
                args[parameter.name] = argument.isDefault ? parameter.default : argument.value;
            } else if (parameter.kind === 'expression') {
                args[parameter.name] = item => this.#evaluate(argument.node, item);
            } else {
                const value = this.#evaluate(argument.node, current);

                if (value === null && parameter.nulls === 'propagate') {
                    return null;
                }

                args[parameter.name] = value;
            }
        }

        return args;
    }

    /** Follows the path a get names, each step from the value before it, answering null from the first null. */
    #follow(steps, receiver, node) {
        let value = receiver;

        for (const step of steps) {
            if (step.kind === 'field') {
                value = value[step.name] ?? null;
            } else {
                const args = Object.fromEntries(step.declaration.parameters.map(parameter => [parameter.name, parameter.default]));

                value = this.#invoke(step.declaration, value, args, step.type, node);
            }

            if (value === null) {
                return null;
            }
        }

        return value;
    }

    /** Carries out a declaration's function, or a predicate's, checking that its result is of the declared type. */
    #invoke(declaration, receiver, args, type, node) {
        const implementation = this.#moduleRegistry.getFunction(declaration);

        if (implementation === undefined) {
            this.#fail(`The module '${this.#moduleRegistry.getOwner(declaration)}' supplies no function for '${declaration.name}'`, this.#pointerOf(node));
        }

        const samples = this.#observe(declaration, receiver, args, node);

        if (samples === null) {
            return null;
        }

        let value;

        try {
            value = implementation(receiver, args, this.#environment, samples);
        } catch (error) {
            throw DomqlError.evaluation(`The member '${declaration.name}' failed: ${error?.message ?? String(error)}`, this.#locate(this.#pointerOf(node)), { cause: error });
        }

        if (!this.#conforms(value, type)) {
            this.#fail(`The member '${declaration.name}' answered ${QueryEvaluator.#describe(value)}, and it declares ${type}`, this.#pointerOf(node));
        }

        this.#observeDetached(declaration, receiver, value, node);

        return value;
    }

    /**
     * Records what the call depends on and holds its observations, answering the samples of its maintained observations, in the order the declaration names them.
     * Answers null where a sample is still pending, which makes the member answer null and the evaluation pending.
     */
    #observe(declaration, receiver, args, node) {
        if (this.#recording === null) {
            if (declaration.reads === 'maintained') {
                this.#fail(`The member '${declaration.name}' is maintained by an observation, and reading it waits for the first sample, which a synchronous evaluation cannot`, this.#pointerOf(node));
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

        dependencies.push({ member: declaration.name, pointer: this.#pointerOf(node), observations: requests });

        if (isPending) {
            this.#recording.isPending = true;

            return null;
        }

        return samples;
    }

    /** A member that answered null because its element is detached depends on whether the element is attached, so it is read again when the element returns. */
    #observeDetached(declaration, receiver, value, node) {
        if (this.#recording === null || value !== null || receiver?.nodeType !== 1 || receiver.isConnected || this.#moduleRegistry.getObservationType('attachment') === undefined) {
            return;
        }

        const request = this.#recording.observations.resolve({ type: 'attachment', of: 'receiver' }, { receiver, args: {} });

        this.#hold(request);
        this.#recording.dependencies.push({ member: declaration.name, pointer: this.#pointerOf(node), observations: [request] });
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

    /** The member a subscription, an action or a behavior request ends in, and where it stands: the shapes of a request each follow the one before, and the first follows that member. */
    #endNode() {
        let node = this.#resolvedDefinition.definition.query;
        let pointer = '/query';

        while (node.kind === 'shape') {
            node = node.target;
            pointer = `${pointer}/target`;
        }

        return { node, pointer };
    }

    /** The occurrence as the fields its type declares, read now, so a projection never holds what the source delivered. */
    #capture(occurrence, node) {
        const pointer = this.#pointerOf(node);
        const { declaration, type } = this.#resolvedDefinition.resolutionOf(node);
        const item = type.item;
        const structure = item.kind === 'named' ? this.#moduleRegistry.getType(item.name) : undefined;

        if (structure === undefined) {
            if (!this.#conforms(occurrence, item)) {
                this.#fail(`The source '${declaration.name}' delivered ${QueryEvaluator.#describe(occurrence)}, and its occurrences are ${item}`, pointer);
            }

            return occurrence;
        }

        const captured = {};

        for (const [name, text] of Object.entries(structure.fields)) {
            const fieldType = Type.parse(text);
            const value = occurrence?.[name];

            if (this.#conforms(value, fieldType)) {
                captured[name] = value;
            } else if (fieldType.isNullable) {
                captured[name] = null;
            } else {
                this.#fail(`The source '${declaration.name}' delivered an occurrence whose '${name}' is ${QueryEvaluator.#describe(value)}, and its type declares ${fieldType}`, pointer);
            }
        }

        return captured;
    }

    #shape(node, current) {
        const hasTarget = node.target !== undefined;
        const target = hasTarget ? this.#evaluate(node.target, current) : current;
        const apply = item => item === null && hasTarget
            ? null
            : Object.fromEntries(node.fields.map(field => [field.name ?? Names.inferField(field.value), this.#evaluate(field.value, item)]));

        if (!(hasTarget && Array.isArray(target))) {
            return apply(target);
        }

        const items = target.map(apply);

        // A list of elements is projected item by item, so each item keeps the element it came from; two elements can project to the same data.
        if (target.length > 0 && target.every(item => item === null || item?.nodeType === 1)) {
            this.#elementsOf.set(items, [...target]);
        }

        return items;
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
                return Array.isArray(value) && QueryEvaluator.#holeOf(value) === -1 && value.every(item => this.#conforms(item, type.item));
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

    /** Where the node stands in the definition, as a JSON Pointer. */
    #pointerOf(node) {
        return this.#resolvedDefinition.pointerOf(node);
    }

    #locate(pointer) {
        return this.#locations?.locate(pointer) ?? { pointer };
    }

    static #isRecord(value) {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    /** The first index of the list that holds no value, or -1 where every index holds one. */
    static #holeOf(list) {
        for (let index = 0; index < list.length; index++) {
            if (!(index in list)) {
                return index;
            }
        }

        return -1;
    }

    /** What the value is, for a message: nothing, a node, or its data where it has any. */
    static #describe(value) {
        if (value === undefined) {
            return 'nothing';
        }

        if (typeof value?.nodeType === 'number') {
            return value.nodeType === 1 ? 'an element' : 'a node';
        }

        const hole = Array.isArray(value) ? QueryEvaluator.#holeOf(value) : -1;

        if (hole !== -1) {
            return `a list with a hole at index ${hole}`;
        }

        try {
            return JSON.stringify(value) ?? String(value);
        } catch {
            return Object.prototype.toString.call(value);
        }
    }

    /** The detached result and its identities, which the evaluator lets go of once it hands them over, so it holds no element between evaluations. */
    #detachResult(value) {
        try {
            return { value: this.#detach(value), identities: this.#detachedIdentities };
        } finally {
            this.#detachedIdentities = null;
        }
    }

    /**
     * A frozen copy of the data sharing no structure with the original; the identities that follow its shape are left in `#detachedIdentities`: for a list projected from elements, the element each item came from, and null where nothing beneath holds one.
     */
    #detach(value) {
        if (Array.isArray(value)) {
            const detached = [];
            const items = [];
            let hasIdentities = false;

            // A hole stays a hole, as a copy of the list keeps it.
            value.forEach((item, index) => {
                detached[index] = this.#detach(item);
                items[index] = this.#detachedIdentities;
                hasIdentities ||= this.#detachedIdentities !== null;
            });
            detached.length = value.length;
            items.length = value.length;

            const elements = this.#elementsOf.get(value) ?? null;

            this.#detachedIdentities = elements === null && !hasIdentities ? null : { elements, items };

            return Object.freeze(detached);
        }

        if (QueryEvaluator.#isRecord(value)) {
            const detached = {};
            let fields = null;

            for (const name of Object.keys(value)) {
                QueryEvaluator.#define(detached, name, this.#detach(value[name]));

                if (this.#detachedIdentities !== null) {
                    fields ??= {};
                    QueryEvaluator.#define(fields, name, this.#detachedIdentities);
                }
            }

            this.#detachedIdentities = fields === null ? null : { fields };

            return Object.freeze(detached);
        }

        this.#detachedIdentities = null;

        return value;
    }

    /** Gives the object a field of its own holding the value, a field named `__proto__` included, as a data object's fields are. */
    static #define(object, name, value) {
        if (name === '__proto__') {
            Object.defineProperty(object, name, { value, writable: true, enumerable: true, configurable: true });
        } else {
            object[name] = value;
        }
    }
}
