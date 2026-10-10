/**
 * Domql — creates DOMQL queries from text and from definitions
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
 * @property {(update: unknown) => unknown} onChange Receives each snapshot, an immutable result that shares what did not change with the snapshot before it, or, where the watch delivers change sets, each baseline and change set. What it returns is not awaited.
 * @property {(error: unknown) => unknown} [onError] Receives a failure of an evaluation and of `onChange`; by default they go to the window's error reporting.
 * @property {'frame' | 'immediate'} [schedule] When an evaluation follows a change: at the next animation frame, once however many observations fired, or in the task that reported it.
 * @property {'snapshot' | 'changeSet'} [updateStrategy] How the watch updates its caller, and so what `onChange` receives: each snapshot whole, or a baseline and then the change sets between snapshots, each acknowledged through the watch's `acknowledge` before the next is sent.
 * @property {boolean} [acceptPartialObservation] Whether the watch accepts a member whose observations only partly cover its changes.
 * @property {Window} [window] The window `@window` stands for, and whose document `@document` stands for.
 */

/**
 * How an event listener listens to a subscription.
 * @typedef {object} DomqlSubscribeConfiguration
 * @property {(result: unknown) => unknown} onEvent Receives the result of each event's projection, immutable data, in the task the event is delivered in. What it returns is not awaited.
 * @property {(error: unknown) => unknown} [onError] Receives a failure of a capture, of a projection and of `onEvent`; by default they go to the window's error reporting.
 * @property {Window} [window] The window `@window` stands for, and whose document `@document` stands for.
 */

/** The kind of request each call carries out, and what the call does with it. */
const READ = { kind: 'query', use: 'read' };
const WATCH = { kind: 'query', use: 'watched' };
const SUBSCRIBE = { kind: 'subscription', use: 'subscribed to' };

/** When a watch evaluates after a change, and how it updates its caller. */
const WATCH_SCHEDULES = ['frame', 'immediate'];
const WATCH_UPDATE_STRATEGIES = ['snapshot', 'changeSet'];

export class Domql {
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

    /** The version of the specification this implementation follows, as major.minor.revision. */
    static get specificationVersion() {
        return Specification.version;
    }

    static #registry = new ModuleRegistry([BrowserModule.create()]);

    /**
     * The resolutions of each query by the options they were made under, valid for the registry revision they were made at and released with the query.
     * @type {WeakMap<DomqlQuery, { revision: number, byOptions: Map<string, import('./language/ResolvedDefinition.mjs').ResolvedDefinition> }>}
     */
    static #resolutions = new WeakMap();

    /** Registers a module's vocabulary, which every query resolved afterwards may use. */
    static registerModule(module) {
        Domql.#registry.registerModule(module);
    }

    /**
     * Resolves a query against the registered vocabulary and types it, without evaluating anything. A query resolved again under the same options and vocabulary answers the resolution it already has.
     * @param {DomqlQuery | string} request The query, or its text, which is parsed as `parse` parses it, through the same cache, with the bindings that follow it.
     * @param {...(Record<string, unknown> | { watch?: boolean, acceptPartialObservation?: boolean })} rest For a text, its bindings and then how it will be carried out; for a query, how it will be carried out.
     */
    static resolve(request, ...rest) {
        const { query, options } = Domql.#requestOf(request, rest);

        return Domql.#resolve(query, options ?? {});
    }

    static #resolve(query, options) {
        const revision = Domql.#registry.revision;
        let kept = Domql.#resolutions.get(query);

        if (kept === undefined || kept.revision !== revision) {
            kept = { revision, byOptions: new Map() };
            Domql.#resolutions.set(query, kept);
        }

        const key = `${options.watch === true}|${options.acceptPartialObservation === true}`;

        if (!kept.byOptions.has(key)) {
            kept.byOptions.set(key, new LanguageResolver(Domql.#registry, query.bindings, ParsedTexts.locationsOf(query.definition), options).resolveDefinition(query.definition));
        }

        return kept.byOptions.get(key);
    }

    /**
     * The observations of each window, so queries read in one window share the observations they have in common.
     * @type {WeakMap<Window, Observations>}
     */
    static #observations = new WeakMap();

    /**
     * Reads a query once, answering immutable data that holds nothing of the document.
     * A member maintained by an observation fails the read, since its first sample cannot arrive during it; `readAsync` waits for it.
     * @param {DomqlQuery | string} request The query, or its text, which is parsed as `parse` parses it, through the same cache, with the bindings that follow it.
     * @param {...(Record<string, unknown> | DomqlReadOptions)} rest For a text, its bindings and then its options; for a query, its options.
     */
    static read(request, ...rest) {
        const { query, options } = Domql.#requestOf(request, rest);
        const { window = globalThis.window } = options ?? {};

        return Domql.#evaluatorOf(query, window, READ).read();
    }

    /**
     * Reads a query once, waiting for the first sample of every maintained member it reads, and answers a promise of immutable data that holds nothing of the document.
     * The query is evaluated again as samples arrive and as what it depends on changes, until an evaluation reads no pending member; every observation it started is let go when the read answers, fails or is canceled.
     * @param {DomqlQuery | string} request The query, or its text, which is parsed as `parse` parses it, through the same cache, with the bindings that follow it.
     * @param {...(Record<string, unknown> | DomqlReadAsyncOptions)} rest For a text, its bindings and then its options; for a query, its options.
     */
    static async readAsync(request, ...rest) {
        const { query, options } = Domql.#requestOf(request, rest);
        const { window = globalThis.window, signal } = options ?? {};

        signal?.throwIfAborted();

        const evaluator = Domql.#evaluatorOf(query, window, READ);
        const observations = Domql.#observationsOf(window);
        const reportError = Domql.#reportErrorOf(window);

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

                // The next evaluation holds its observations before the last lets go of its own, so one both need keeps running.
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
     * @param {DomqlQuery | string} request The query, or its text, which is parsed as `parse` parses it, through the same cache, with the bindings that follow it.
     * @param {...(Record<string, unknown> | DomqlWatchConfiguration)} rest For a text, its bindings and then its configuration; for a query, its configuration.
     */
    static watch(request, ...rest) {
        const { query, options: configuration } = Domql.#requestOf(request, rest);
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

        const resolution = { watch: true, acceptPartialObservation: acceptPartialObservation === true };
        const evaluator = Domql.#evaluatorOf(query, window, WATCH, resolution);
        const resolved = Domql.#resolve(query, resolution);

        if (schedule === 'frame' && typeof window.requestAnimationFrame !== 'function') {
            throw DomqlError.structure("A watch scheduled by animation frame needs a window that has them; schedule it as 'immediate' otherwise", {});
        }

        return new Watch({
            evaluator,
            observations: Domql.#observationsOf(window),
            comparer: new SnapshotComparer(resolved),
            window,
            reportError: Domql.#reportErrorOf(window),
            configuration: { schedule, updateStrategy, onChange, onError },
        });
    }

    /**
     * Subscribes to a subscription's occurrence source, answering the event listener that listens to it: at each event the source delivers, evaluates the shape that follows the source against it, in the task the source delivers it in, and hands the result to `onEvent`.
     * Listening starts in the call, so an event that follows it is heard, and a source that cannot start fails the call. The source's receiver and arguments are evaluated once, as listening starts.
     * @param {DomqlQuery | string} request The subscription, or its text, which is parsed as `parse` parses it, through the same cache, with the bindings that follow it.
     * @param {...(Record<string, unknown> | DomqlSubscribeConfiguration)} rest For a text, its bindings and then its configuration; for a subscription, its configuration.
     */
    static subscribe(request, ...rest) {
        const { query, options: configuration } = Domql.#requestOf(request, rest);
        const { onEvent, onError, window = globalThis.window } = configuration ?? {};

        if (typeof onEvent !== 'function') {
            throw DomqlError.structure('An event listener takes the function that receives the result of each event, as onEvent', {});
        }

        if (onError !== undefined && typeof onError !== 'function') {
            throw DomqlError.structure('The error callback of an event listener is a function', {});
        }

        return new EventListener({
            evaluator: Domql.#evaluatorOf(query, window, SUBSCRIBE),
            observations: Domql.#observationsOf(window),
            reportError: Domql.#reportErrorOf(window),
            configuration: { onEvent, onError },
        });
    }

    /** The window's error reporting, which a failure no callback receives reaches. */
    static #reportErrorOf(window) {
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

    /**
     * The query a call names, parsed where it is given as text, and the options or the configuration that follow it: the bindings come between a text and what follows them, and a query carries its own.
     * A query belongs to the DOMQL instance that made it, and another instance, such as one an independently bundled library carries, refuses it; `create` makes it again from its definition and raw bindings, validated and resolved against this instance's own vocabulary.
     */
    static #requestOf(request, rest) {
        if (typeof request === 'string') {
            return { query: Domql.parse(request, rest[0]), options: rest[1] };
        }

        if (!(request instanceof DomqlQuery)) {
            throw DomqlError.structure('Expected a query created by this DOMQL instance. To reuse a query from another instance, pass its definition and bindings to Domql.create.', {});
        }

        return { query: request, options: rest[0] };
    }

    /**
     * The evaluator of a request a call carries out: the request is resolved, refused with a validation error where it is not of the kind the call carries out, before anything is evaluated or started, and then given its window.
     * @param {DomqlQuery} query The request.
     * @param {Window} window The window it is carried out in.
     * @param {{ kind: string, use: string }} call The kind of request the call carries out, and what the call does with it, for the refusal to say.
     * @param {{ watch?: boolean, acceptPartialObservation?: boolean }} [resolution] How the request is resolved.
     */
    static #evaluatorOf(query, window, { kind, use }, resolution = {}) {
        const resolved = Domql.#resolve(query, resolution);

        if (resolved.kind !== kind) {
            const article = resolved.kind === 'action' ? 'An' : 'A';

            throw DomqlError.validation(`${article} ${resolved.kind} request is not ${use}`, ParsedTexts.locationsOf(query.definition)?.locate('/query') ?? { pointer: '/query' });
        }

        if (!window?.document) {
            throw DomqlError.evaluation('DOMQL cannot read without a browser window. Pass a window explicitly when running outside a browser.', {});
        }

        return new QueryEvaluator(Domql.#registry, resolved, query.bindings, { window, document: window.document }, ParsedTexts.locationsOf(query.definition));
    }

    static #observationsOf(window) {
        let observations = Domql.#observations.get(window);

        if (observations === undefined) {
            observations = new Observations(Domql.#registry, { window, document: window.document });
            Domql.#observations.set(window, observations);
        }

        return observations;
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

        return new DomqlQuery(ParsedTexts.parse(text), new ParameterBindings(bindings));
    }

    /**
     * Creates a query from its definition, binding its parameters.
     * @param {object} definition The query's definition.
     * @param {Record<string, unknown>} bindings Each parameter's name and the value it is bound to.
     */
    static create(definition, bindings = {}) {
        return new DomqlQuery(new DefinitionValidator().validate(definition), new ParameterBindings(bindings));
    }
}
