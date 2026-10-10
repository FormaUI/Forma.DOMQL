/**
 * Domql — constructs, resolves, reads and watches queries, and subscribes to events
 */

import { SnapshotComparer } from './snapshots/SnapshotComparer.mjs';
import { BrowserModule } from './dom/BrowserModule.mjs';
import { Observations } from './dom/Observations.mjs';
import { QueryEvaluator } from './dom/QueryEvaluator.mjs';
import { EventListener } from './dom/EventListener.mjs';
import { Watch } from './dom/Watch.mjs';
import { CurrentSnapshot } from './snapshots/CurrentSnapshot.mjs';
import { DefinitionValidator } from './language/DefinitionValidator.mjs';
import { DomqlError } from './language/DomqlError.mjs';
import { DomqlModule } from './language/vocabulary/DomqlModule.mjs';
import { DomqlQuery } from './language/DomqlQuery.mjs';
import { LanguageResolver } from './language/LanguageResolver.mjs';
import { ModuleRegistry } from './language/vocabulary/ModuleRegistry.mjs';
import { ParameterBindings } from './language/ParameterBindings.mjs';
import { ParsedTexts } from './language/ParsedTexts.mjs';
import { Specification } from './language/Specification.mjs';
import { TypedBinding } from './language/TypedBinding.mjs';

/**
 * How a query is resolved.
 * @typedef {object} DomqlResolveOptions
 * @property {boolean} [watch] Whether the query will be watched.
 * @property {boolean} [acceptPartialObservation] Whether a watch accepts members whose changes its observations only partly cover.
 */

/**
 * How a read is carried out.
 * @typedef {object} DomqlReadOptions
 * @property {Window} [window] The window `@window` stands for, and whose document `@document` stands for; by default the environment's.
 */

/**
 * How a read that waits is carried out.
 * @typedef {object} DomqlReadAsyncOptions
 * @property {Window} [window] The window `@window` stands for, and whose document `@document` stands for; by default the environment's.
 * @property {AbortSignal} [signal] Cancels the read, which then fails with the signal's reason.
 */

/**
 * How a query is watched.
 * @typedef {object} DomqlWatchConfiguration
 * @property {(update: unknown) => unknown} onChange Receives each snapshot, which shares what did not change with the snapshot before it, or, where the watch delivers change sets, each baseline and change set. What it returns is not awaited.
 * @property {(error: unknown) => unknown} [onError] Receives a failure of an evaluation and of `onChange`; by default they go to the window's error reporting.
 * @property {'frame' | 'immediate'} [schedule] When an evaluation follows a change: at the next animation frame, once however many observations fired, or in the task that reported it.
 * @property {'snapshot' | 'changeSet'} [updateStrategy] What `onChange` receives: each snapshot whole, or a baseline and then the change sets between snapshots, each acknowledged through the watch's `acknowledge` before the next is sent.
 * @property {boolean} [acceptPartialObservation] Whether the watch accepts a member whose observations only partly cover its changes.
 * @property {Window} [window] The window `@window` stands for, and whose document `@document` stands for.
 */

/**
 * How an event listener listens to a subscription.
 * @typedef {object} DomqlSubscribeConfiguration
 * @property {(result: unknown) => unknown} onEvent Receives each projected result, an immutable snapshot containing no live DOM references, in the task the event is delivered in. What it returns is not awaited.
 * @property {(error: unknown) => unknown} [onError] Receives a failure of a capture, of a projection and of `onEvent`; by default they go to the window's error reporting.
 * @property {Window} [window] The window `@window` stands for, and whose document `@document` stands for.
 */

/** Each method that takes a query or its text: its name, the kind of request it carries out, what it does with one, and what follows the parameters. */
const RESOLVE = { name: 'resolve', trailing: 'options' };
const READ = { name: 'read', kind: 'query', use: 'read', trailing: 'options' };
const READ_ASYNC = { name: 'readAsync', kind: 'query', use: 'read', trailing: 'options' };
const WATCH = { name: 'watch', kind: 'query', use: 'watched', trailing: 'configuration' };
const SUBSCRIBE = { name: 'subscribe', kind: 'subscription', use: 'subscribed to', trailing: 'configuration' };

/** When a watch evaluates after a change, and what it delivers. */
const WATCH_SCHEDULES = ['frame', 'immediate'];
const WATCH_UPDATE_STRATEGIES = ['snapshot', 'changeSet'];

export class Domql {
    static #moduleRegistry = new ModuleRegistry([BrowserModule.create()]);

    /**
     * The resolutions of each query by the options they were made under, valid for the registry revision they were made at and released with the query.
     * @type {WeakMap<DomqlQuery, { revision: number, byOptions: Map<string, import('./language/ResolvedDefinition.mjs').ResolvedDefinition> }>}
     */
    static #resolutionCache = new WeakMap();

    /**
     * The observations of each window, so queries read in one window share the observations they have in common.
     * @type {WeakMap<Window, Observations>}
     */
    static #observationsByWindow = new WeakMap();

    /** The version of the specification this implementation follows, as major.minor.revision. */
    static get specificationVersion() {
        return Specification.version;
    }

    /**
     * Parses text into a query, binding its parameters.
     * @param {string} text The query text.
     * @param {Record<string, unknown>} [parameters] Each parameter's name and the value it is bound to.
     * @returns {DomqlQuery}
     */
    static parse(text, parameters = {}) {
        if (typeof text !== 'string') {
            throw new TypeError('A query text is a string');
        }

        return new DomqlQuery(ParsedTexts.parse(text), new ParameterBindings(parameters));
    }

    /**
     * Creates a query from its definition, binding its parameters.
     * @param {object} definition The query's definition.
     * @param {Record<string, unknown>} [parameters] Each parameter's name and the value it is bound to.
     * @returns {DomqlQuery}
     */
    static create(definition, parameters = {}) {
        return new DomqlQuery(new DefinitionValidator().validate(definition), new ParameterBindings(parameters));
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
     * Resolves a query against the registered vocabulary and types it, without evaluating anything. A query resolved again under the same options and vocabulary returns the resolution it already has.
     *
     * @overload
     * @param {string} text The query text, parsed as `parse` parses it, through the same cache.
     * @param {Record<string, unknown>} [parameters] Each parameter's name and the value it is bound to.
     * @param {DomqlResolveOptions} [options] How the query will be carried out.
     * @returns {import('./language/ResolvedDefinition.mjs').ResolvedDefinition}
     *
     * @overload
     * @param {DomqlQuery} query The query.
     * @param {DomqlResolveOptions} [options] How the query will be carried out.
     * @returns {import('./language/ResolvedDefinition.mjs').ResolvedDefinition}
     */
    static resolve(input, ...rest) {
        const { query, options } = Domql.#normalizeArguments(RESOLVE, input, rest);

        return Domql.#resolve(query, options ?? {});
    }

    /**
     * Reads a query once, returning an immutable snapshot containing no live DOM references.
     * A member maintained by an observation fails the read, since its first sample cannot arrive during it; `readAsync` waits for it.
     *
     * @overload
     * @param {string} text The query text, parsed as `parse` parses it, through the same cache.
     * @param {Record<string, unknown>} [parameters] Each parameter's name and the value it is bound to.
     * @param {DomqlReadOptions} [options] How the read is carried out.
     * @returns {unknown}
     *
     * @overload
     * @param {DomqlQuery} query The query.
     * @param {DomqlReadOptions} [options] How the read is carried out.
     * @returns {unknown}
     */
    static read(input, ...rest) {
        const { query, options } = Domql.#normalizeArguments(READ, input, rest);
        const { window = globalThis.window } = options ?? {};

        return Domql.#createEvaluator(query, Domql.#resolveFor(READ, query), window).read();
    }

    /**
     * Reads a query once, waiting for the first sample of every maintained member it reads. Returns a promise of an immutable snapshot containing no live DOM references.
     * The query is evaluated again as samples arrive and as what it depends on changes, until an evaluation reads no pending member; every observation it started is released when the read settles, fails or is canceled.
     *
     * @overload
     * @param {string} text The query text, parsed as `parse` parses it, through the same cache.
     * @param {Record<string, unknown>} [parameters] Each parameter's name and the value it is bound to.
     * @param {DomqlReadAsyncOptions} [options] How the read is carried out.
     * @returns {Promise<unknown>}
     *
     * @overload
     * @param {DomqlQuery} query The query.
     * @param {DomqlReadAsyncOptions} [options] How the read is carried out.
     * @returns {Promise<unknown>}
     */
    static async readAsync(input, ...rest) {
        const { query, options } = Domql.#normalizeArguments(READ_ASYNC, input, rest);
        const { window = globalThis.window, signal } = options ?? {};

        signal?.throwIfAborted();

        const evaluator = Domql.#createEvaluator(query, Domql.#resolveFor(READ_ASYNC, query), window);
        const observations = Domql.#getObservations(window);
        const reportError = Domql.#createErrorReporter(window);

        return new Promise((resolve, reject) => {
            let queryEvaluation = null;
            let isScheduled = false;
            let isSettled = false;

            // A cleanup that fails is reported, and never replaces the read's result, its failure or its cancellation.
            const release = evaluation => {
                try {
                    evaluation?.dispose();
                } catch (error) {
                    reportError(error);
                }
            };
            const settle = outcome => {
                isSettled = true;
                signal?.removeEventListener('abort', cancel);
                release(queryEvaluation);
                outcome();
            };
            const cancel = () => settle(() => reject(signal.reason));
            const evaluate = () => {
                isScheduled = false;

                if (isSettled) {
                    return;
                }

                const next = evaluator.evaluate({ observations, onChange: schedule });

                // The next evaluation holds its observations before the last releases its own, so one both need keeps running.
                release(queryEvaluation);
                queryEvaluation = next;

                if (next.error !== null) {
                    settle(() => reject(next.error));
                } else if (!next.isPending) {
                    settle(() => resolve(next.value));
                }
            };
            // An observation reports a change inside its own delivery, so the evaluation that follows waits for it to end.
            const schedule = () => {
                if (!isSettled && !isScheduled) {
                    isScheduled = true;
                    queueMicrotask(evaluate);
                }
            };

            signal?.addEventListener('abort', cancel, { once: true });
            evaluate();
        });
    }

    /**
     * Watches a query: evaluates it, reports a snapshot of the result, and evaluates again when something the result depends on changes, reporting a snapshot that differs from the last.
     * The first snapshot is reported after the call returns, as the baseline, through the same callback as every later one.
     *
     * @overload
     * @param {string} text The query text, parsed as `parse` parses it, through the same cache.
     * @param {Record<string, unknown>} parameters Each parameter's name and the value it is bound to; `{}` for a text that has none.
     * @param {DomqlWatchConfiguration} configuration How the query is watched.
     * @returns {Watch}
     *
     * @overload
     * @param {DomqlQuery} query The query.
     * @param {DomqlWatchConfiguration} configuration How the query is watched.
     * @returns {Watch}
     */
    static watch(input, ...rest) {
        const { query, options: configuration } = Domql.#normalizeArguments(WATCH, input, rest);
        const { onChange, onError, schedule = 'frame', updateStrategy = 'snapshot', acceptPartialObservation = false, window = globalThis.window } = configuration ?? {};

        if (typeof onChange !== 'function') {
            throw DomqlError.structure('A watch takes the function that receives its snapshots, as onChange', {});
        }

        if (onError !== undefined && typeof onError !== 'function') {
            throw DomqlError.structure('The error callback of a watch is a function', {});
        }

        if (!WATCH_SCHEDULES.includes(schedule)) {
            throw DomqlError.structure(`A watch is scheduled as ${WATCH_SCHEDULES.join(' or ')}`, {});
        }

        if (!WATCH_UPDATE_STRATEGIES.includes(updateStrategy)) {
            throw DomqlError.structure(`The update strategy of a watch is ${WATCH_UPDATE_STRATEGIES.join(' or ')}`, {});
        }

        const resolved = Domql.#resolveFor(WATCH, query, { watch: true, acceptPartialObservation: acceptPartialObservation === true });
        const evaluator = Domql.#createEvaluator(query, resolved, window);

        if (schedule === 'frame' && typeof window.requestAnimationFrame !== 'function') {
            throw DomqlError.structure("A watch scheduled by animation frame needs a window that has them; schedule it as 'immediate' otherwise", {});
        }

        return new Watch({
            evaluator,
            observations: Domql.#getObservations(window),
            comparer: new SnapshotComparer(resolved),
            window,
            reportError: Domql.#createErrorReporter(window),
            configuration: { schedule, updateStrategy, onChange, onError },
        });
    }

    /**
     * Subscribes to an event source and passes each projected result to `onEvent`. Returns the event listener, which listens from the call on, so an event that follows the call is heard; a source that cannot start fails the call.
     * Each result is the shape that follows the source, evaluated against the event in the task the event is delivered in. The source's receiver and arguments are evaluated once, as listening starts.
     *
     * @overload
     * @param {string} text The subscription text, parsed as `parse` parses it, through the same cache.
     * @param {Record<string, unknown>} parameters Each parameter's name and the value it is bound to; `{}` for a text that has none.
     * @param {DomqlSubscribeConfiguration} configuration How the event listener listens.
     * @returns {EventListener}
     *
     * @overload
     * @param {DomqlQuery} query The subscription.
     * @param {DomqlSubscribeConfiguration} configuration How the event listener listens.
     * @returns {EventListener}
     */
    static subscribe(input, ...rest) {
        const { query, options: configuration } = Domql.#normalizeArguments(SUBSCRIBE, input, rest);
        const { onEvent, onError, window = globalThis.window } = configuration ?? {};

        if (typeof onEvent !== 'function') {
            throw DomqlError.structure('An event listener takes the function that receives the result of each event, as onEvent', {});
        }

        if (onError !== undefined && typeof onError !== 'function') {
            throw DomqlError.structure('The error callback of an event listener is a function', {});
        }

        return new EventListener({
            evaluator: Domql.#createEvaluator(query, Domql.#resolveFor(SUBSCRIBE, query), window),
            observations: Domql.#getObservations(window),
            reportError: Domql.#createErrorReporter(window),
            configuration: { onEvent, onError },
        });
    }

    /** Creates the current snapshot a watch's change sets build: it applies each update atomically to the snapshot it was computed against and gives a stale one no effect. */
    static createSnapshot() {
        return new CurrentSnapshot();
    }

    /**
     * Creates a module from the vocabulary it declares and the functions that carry the members out.
     * @param {string} name The module's name.
     * @param {object} contents What the module declares.
     * @param {Record<string, Function> | null} functions The functions the members name.
     */
    static createModule(name, contents, functions = null) {
        return new DomqlModule(name, contents, functions);
    }

    /** Registers a module's vocabulary, which every query resolved afterwards may use. */
    static registerModule(module) {
        Domql.#moduleRegistry.registerModule(module);
    }

    /**
     * Interprets the arguments of a method that takes a query or its text: a text is parsed with the parameters that follow it, and a query carries its own. Returns the query and the options or the configuration that come last.
     * A call given more arguments than its form takes is refused, so a misplaced argument is never silently ignored. A query belongs to the DOMQL instance that made it, and another instance, such as one an independently bundled library carries, refuses it; `create` makes it again from its definition and raw parameters, validated and resolved against this instance's own vocabulary.
     * @param {{ name: string, trailing: string }} method The method, and what follows the parameters in it.
     * @param {DomqlQuery | string} input The query, or its text.
     * @param {unknown[]} rest The arguments after it.
     */
    static #normalizeArguments({ name, trailing }, input, rest) {
        if (typeof input === 'string') {
            if (rest.length > 2) {
                throw DomqlError.structure(`Domql.${name} takes a text, its parameters and its ${trailing}, and was given ${1 + rest.length} arguments`, {});
            }

            return { query: Domql.parse(input, rest[0]), options: rest[1] };
        }

        if (!(input instanceof DomqlQuery)) {
            throw DomqlError.structure('Expected a query created by this DOMQL instance. To reuse a query from another instance, pass its definition and parameters to Domql.create.', {});
        }

        if (rest.length > 1) {
            throw DomqlError.structure(`Domql.${name} takes a query and its ${trailing}, and was given ${1 + rest.length} arguments; a query carries its own parameters`, {});
        }

        return { query: input, options: rest[0] };
    }

    static #resolve(query, options) {
        const revision = Domql.#moduleRegistry.revision;
        let kept = Domql.#resolutionCache.get(query);

        if (kept === undefined || kept.revision !== revision) {
            kept = { revision, byOptions: new Map() };
            Domql.#resolutionCache.set(query, kept);
        }

        const key = `${options.watch === true}|${options.acceptPartialObservation === true}`;

        if (!kept.byOptions.has(key)) {
            kept.byOptions.set(key, new LanguageResolver(Domql.#moduleRegistry, query.bindings, ParsedTexts.locationsOf(query.definition), options).resolveDefinition(query.definition));
        }

        return kept.byOptions.get(key);
    }

    /**
     * Resolves a request for the method that carries it out, refusing it with a validation error where it is not of the kind the method carries out, before anything is evaluated or started.
     * @param {{ kind: string, use: string }} method The kind of request the method carries out, and what it does with one, for the refusal to say.
     * @param {DomqlQuery} query The request.
     * @param {DomqlResolveOptions} [options] How the request is resolved.
     */
    static #resolveFor({ kind, use }, query, options = {}) {
        const resolved = Domql.#resolve(query, options);

        if (resolved.kind !== kind) {
            const article = resolved.kind === 'action' ? 'An' : 'A';

            throw DomqlError.validation(`${article} ${resolved.kind} request is not ${use}`, ParsedTexts.locationsOf(query.definition)?.locate('/query') ?? { pointer: '/query' });
        }

        return resolved;
    }

    /** Creates the evaluator of a resolved request in its window, which an evaluation needs. */
    static #createEvaluator(query, resolved, window) {
        if (!window?.document) {
            throw DomqlError.evaluation('DOMQL cannot read without a browser window. Pass a window explicitly when running outside a browser.', {});
        }

        return new QueryEvaluator(Domql.#moduleRegistry, resolved, query.bindings, { window, document: window.document }, ParsedTexts.locationsOf(query.definition));
    }

    /** Returns the observations shared by everything carried out in the window, creating them on first use. */
    static #getObservations(window) {
        let observations = Domql.#observationsByWindow.get(window);

        if (observations === undefined) {
            observations = new Observations(Domql.#moduleRegistry, { window, document: window.document });
            Domql.#observationsByWindow.set(window, observations);
        }

        return observations;
    }

    /** Creates the function that reports a failure no callback receives to the window's error reporting; a failure of the reporting itself is dropped. */
    static #createErrorReporter(window) {
        return error => {
            try {
                if (window.reportError) {
                    window.reportError(error);
                } else {
                    console.error(error);
                }
            } catch {
                // Keep a reporter failure from interrupting the caller.
            }
        };
    }
}
