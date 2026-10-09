/**
 * Domql — creates DOMQL queries from text and from definitions
 */

import { SnapshotComparer } from './dom/SnapshotComparer.mjs';
import { BrowserModule } from './dom/BrowserModule.mjs';
import { Observations } from './dom/Observations.mjs';
import { QueryEvaluator } from './dom/QueryEvaluator.mjs';
import { Watch } from './dom/Watch.mjs';
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

/** When a watch evaluates after a change, and what it delivers. */
const WATCH_SCHEDULES = ['frame', 'immediate'];
const WATCH_DELIVERIES = ['snapshot'];

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
     * @param {DomqlQuery} query The query to resolve.
     * @param {{ watch?: boolean, acceptPartialObservation?: boolean }} options How the query will be carried out.
     */
    static resolve(query, options = {}) {
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
     * @param {DomqlQuery} query The query to read.
     * @param {{ window?: Window }} [options] The window `@window` stands for, and whose document `@document` stands for.
     */
    static read(query, { window = globalThis.window } = {}) {
        return Domql.#evaluatorOf(query, window).read();
    }

    /**
     * Reads a query once, waiting for the first sample of every maintained member it reads, and answers a promise of immutable data that holds nothing of the document.
     * The query is evaluated again as samples arrive and as what it depends on changes, until an evaluation reads no pending member; every observation it started is let go when the read answers, fails or is canceled.
     * @param {DomqlQuery} query The query to read.
     * @param {{ window?: Window, signal?: AbortSignal }} [options] The window `@window` stands for, and whose document `@document` stands for, and a signal that cancels the read, which then fails with the signal's reason.
     */
    static async readAsync(query, { window = globalThis.window, signal } = {}) {
        signal?.throwIfAborted();

        const evaluator = Domql.#evaluatorOf(query, window);
        const observations = Domql.#observationsOf(window);

        return new Promise((resolve, reject) => {
            let queryEvaluation = null;
            let isScheduled = false;
            let isSettled = false;

            const settle = outcome => {
                isSettled = true;
                signal?.removeEventListener('abort', cancel);
                queryEvaluation?.dispose();
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
                queryEvaluation?.dispose();
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
     * @param {DomqlQuery} query The query to watch.
     * @param {object} options How the query is watched.
     * @param {(snapshot: unknown) => unknown} options.onChange Receives each snapshot, an immutable result that shares what did not change with the snapshot before it. What it returns is not awaited.
     * @param {(error: unknown) => unknown} [options.onError] Receives a failure of an evaluation and of `onChange`; by default they go to the window's error reporting.
     * @param {'frame' | 'immediate'} [options.schedule] When an evaluation follows a change: at the next animation frame, once however many observations fired, or in the task that reported it.
     * @param {'snapshot'} [options.delivery] What `onChange` receives.
     * @param {boolean} [options.acceptPartialObservation] Whether the watch accepts a member whose observations only partly cover its changes.
     * @param {Window} [options.window] The window `@window` stands for, and whose document `@document` stands for.
     */
    static watch(query, { onChange, onError, schedule = 'frame', delivery = 'snapshot', acceptPartialObservation = false, window = globalThis.window } = {}) {
        if (typeof onChange !== 'function') {
            throw DomqlError.structure('A watch takes the function that receives its snapshots, as onChange', {});
        }

        if (onError !== undefined && typeof onError !== 'function') {
            throw DomqlError.structure('The error callback of a watch is a function', {});
        }

        if (!WATCH_SCHEDULES.includes(schedule)) {
            throw DomqlError.structure(`A watch is scheduled as ${WATCH_SCHEDULES.join(' or ')}`, {});
        }

        if (!WATCH_DELIVERIES.includes(delivery)) {
            throw DomqlError.structure(`A watch delivers ${WATCH_DELIVERIES.join(' or ')}`, {});
        }

        const options = { watch: true, acceptPartialObservation: acceptPartialObservation === true };
        const evaluator = Domql.#evaluatorOf(query, window, options);
        const resolved = Domql.resolve(query, options);

        if (resolved.kind !== 'query') {
            throw DomqlError.evaluation(`A ${resolved.kind} request is not watched`, { pointer: '/query' });
        }

        if (schedule === 'frame' && typeof window.requestAnimationFrame !== 'function') {
            throw DomqlError.structure("A watch scheduled by animation frame needs a window that has them; schedule it as 'immediate' otherwise", {});
        }

        return new Watch({
            evaluator,
            observations: Domql.#observationsOf(window),
            comparer: new SnapshotComparer(resolved),
            window,
            reportError: error => (window.reportError ? window.reportError(error) : console.error(error)),
            options: { schedule, onChange, onError },
        });
    }

    static #evaluatorOf(query, window, options = {}) {
        if (!window?.document) {
            throw DomqlError.evaluation('DOMQL cannot read without a browser window. Pass a window explicitly when running outside a browser.', {});
        }

        const resolved = Domql.resolve(query, options);

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
