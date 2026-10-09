/**
 * Observations — the observations a window's queries hold, started on first use, shared between equivalent requests and ended when the last holder lets go
 */

import { DomqlError } from './DomqlError.mjs';
import { ObservationSession } from './ObservationSession.mjs';

/** The properties of an observation that are not arguments of its type. */
const OBSERVATION_PROPERTIES = new Set(['type', 'of']);

export class Observations {
    #moduleRegistry;
    #environment;
    #reportError;

    /**
     * What is observed on each target, by the identity of the request: held while a holder holds it, so an observation outlives neither its sessions nor its target.
     * @type {WeakMap<object, Map<string, { observation: any, holders: Set<ObservationSession>, observed: Map<string, any>, key: string }>>}
     */
    #targets = new WeakMap();

    /** Every observation running, so they can all be ended. */
    #running = new Set();

    /** The numbers that tell objects apart in an identity. @type {WeakMap<object, number>} */
    #numbers = new WeakMap();
    #nextNumber = 1;
    #nextUnshared = 1;

    /**
     * @param {import('./ModuleRegistry.mjs').ModuleRegistry} moduleRegistry The vocabulary whose observation types start the observations.
     * @param {{ window: Window, document: Document }} environment The window the observations belong to; observations of two windows never share.
     * @param {{ reportError?: (error: unknown) => void }} [options] Where a failure of a holder's callback, or of stopping an observation, is reported, by default the window's. A failure of the report itself is dropped, so reporting never interrupts what reports.
     */
    constructor(moduleRegistry, environment, { reportError } = {}) {
        const report = reportError ?? (error => (environment.window.reportError ? environment.window.reportError(error) : console.error(error)));

        this.#moduleRegistry = moduleRegistry;
        this.#environment = environment;
        this.#reportError = error => {
            try {
                report(error);
            } catch {
                // Nothing is left to report to.
            }
        };
    }

    /**
     * Resolves an observation a declaration names against a call into the request to start: the type, the target the observation names, and its arguments with each argument it names replaced by its value.
     * Answers null where the target is an argument that is null, which has nothing to observe.
     * @param {object} observation The observation a declaration names.
     * @param {{ receiver: unknown, args: Record<string, unknown> }} call The call's receiver and its arguments by parameter name.
     */
    resolve(observation, { receiver, args }) {
        const target = this.#targetOf(observation.of, receiver, args);

        if (target === null || target === undefined) {
            return null;
        }

        const resolved = {};

        for (const [name, value] of Object.entries(observation)) {
            if (!OBSERVATION_PROPERTIES.has(name)) {
                resolved[name] = Observations.#valueOf(value, args);
            }
        }

        return { type: observation.type, target, arguments: resolved };
    }

    /**
     * Holds the observation the request names, starting it where no equivalent request holds one, and answers the session.
     * @param {{ type: string, target: object, arguments: Record<string, any> } | null} request What to observe, as `resolve` answers it.
     * @param {() => void} onChange Called, synchronously, when something may have changed. What it returns is ignored: a promise it returns is not awaited, and a rejection of it is not caught here.
     */
    acquire(request, onChange) {
        if (request === null) {
            return ObservationSession.none();
        }

        const type = this.#moduleRegistry.getObservationType(request.type);

        if (type === undefined) {
            throw DomqlError.evaluation(`The observation type '${request.type}' is declared by no module`, {});
        }

        const key = type.shared ? this.#identityOf(type, request) : `${type.name}#${this.#nextUnshared++}`;
        let observed = this.#targets.get(request.target);

        if (observed === undefined) {
            observed = new Map();
            this.#targets.set(request.target, observed);
        }

        let entry = observed.get(key);

        if (entry === undefined) {
            const created = { observation: null, holders: new Set(), observed, key };

            created.observation = this.#start(type, request, () => {
                for (const held of [...created.holders]) {
                    held.notify();
                }
            });
            entry = created;
            observed.set(key, entry);
            this.#running.add(entry);
        }

        const session = new ObservationSession({
            contract: type.contract,
            observation: entry.observation,
            onChange,
            end: ended => this.#end(entry, ended),
            reportError: this.#reportError,
        });

        entry.holders.add(session);

        return session;
    }

    /** Ends every observation and disposes every session, for a host that is done with the window. */
    dispose() {
        for (const entry of [...this.#running]) {
            for (const session of [...entry.holders]) {
                session.dispose();
            }
        }
    }

    /** How many observations are running, which ends with the last session of each. */
    get running() {
        return this.#running.size;
    }

    #targetOf(of, receiver, args) {
        switch (of) {
            case 'receiver':
                return receiver;
            case 'window':
                return this.#environment.window;
            case 'document':
                return this.#environment.document;
            default:
                return args[of.argument];
        }
    }

    static #valueOf(value, args) {
        if (Array.isArray(value)) {
            return value.map(item => Observations.#valueOf(item, args));
        }

        if (value !== null && typeof value === 'object') {
            if (typeof value.argument !== 'string') {
                throw new TypeError('An observation gives literals, lists of them and arguments of the member');
            }

            return args[value.argument];
        }

        return value;
    }

    #start(type, request, notify) {
        const start = this.#moduleRegistry.getFunction(type);

        if (start === undefined) {
            throw DomqlError.evaluation(`The module '${this.#moduleRegistry.getOwner(type)}' supplies no function for the observation type '${type.name}'`, {});
        }

        let observation;

        try {
            observation = start(request, notify, this.#environment);
        } catch (error) {
            throw DomqlError.evaluation(`The observation '${type.name}' failed to start: ${error.message}`, {}, { cause: error });
        }

        if (typeof observation?.stop !== 'function' || (type.contract === 'maintained' && typeof observation.sample !== 'function')) {
            observation?.stop?.();

            throw DomqlError.evaluation(`The observation type '${type.name}' started an observation that offers ${type.contract === 'maintained' ? 'no stop or no sample' : 'no stop'}`, {});
        }

        return observation;
    }

    #end(entry, session) {
        entry.holders.delete(session);

        if (entry.holders.size > 0) {
            return;
        }

        entry.observed.delete(entry.key);
        this.#running.delete(entry);

        try {
            entry.observation.stop();
        } catch (error) {
            this.#reportError(error);
        }
    }

    /** The request's identity: its type and the arguments that belong to the type's identity, with objects told apart by number. */
    #identityOf(type, request) {
        return [type.name, ...type.identity.map(name => this.#describe(request.arguments[name]))].join('|');
    }

    #describe(value) {
        if (value === null || value === undefined) {
            return 'null';
        }

        if (Array.isArray(value)) {
            return `[${value.map(item => this.#describe(item)).join(',')}]`;
        }

        if (typeof value === 'object' || typeof value === 'function') {
            if (!this.#numbers.has(value)) {
                this.#numbers.set(value, this.#nextNumber++);
            }

            return `#${this.#numbers.get(value)}`;
        }

        return JSON.stringify(value);
    }
}
