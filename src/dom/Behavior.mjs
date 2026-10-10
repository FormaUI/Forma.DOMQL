/**
 * Behavior — one activated behavior: it activates the instance its module creates, replaces the bindings it runs with when updated, and disposes it
 */

import { DomqlError } from '../language/DomqlError.mjs';

/** @typedef {{ declaration: object, name: string, activate: Function, receiver: unknown, args: Record<string, unknown> | null, environment: object, location: object }} BehaviorCall */

export class Behavior {
    #prepare;
    #reportError;
    #declaration;

    /** The instance the behavior's module created, or null while a null receiver or argument leaves nothing to activate. @type {{ update: Function, dispose: Function } | null} */
    #instance = null;

    /** `ready` from activation on, and `disposed` once ended. @type {'ready' | 'disposed'} */
    #status = 'ready';

    /**
     * Activates the behavior, which is in effect once the constructor returns; a behavior that cannot activate fails it, and leaves nothing running.
     * @param {object} dependencies What the behavior activates, and what it works with.
     * @param {BehaviorCall} dependencies.call The behavior resolved against its first bindings.
     * @param {(bindings: unknown) => BehaviorCall} dependencies.prepare Resolves the behavior against other bindings, throwing a validation or an evaluation error where they cannot be used.
     * @param {(error: unknown) => void} dependencies.reportError The diagnostic reporting boundary, which a failure inside the running behavior, or of disposing it, reaches.
     */
    constructor({ call, prepare, reportError }) {
        this.#prepare = prepare;
        this.#reportError = reportError;
        this.#declaration = call.declaration;
        this.#instance = call.args === null ? null : this.#activate(call);
    }

    /** `ready` from activation on, and `disposed` once ended. */
    get status() {
        return this.#status;
    }

    /**
     * Replaces the bindings the behavior runs with, whole. The bindings are checked, the request resolved again and its receiver and arguments evaluated before anything changes; a failure there throws, and leaves the behavior running as it was.
     * Only then does the behavior's own update receive the new receiver and arguments; a failure there throws an evaluation error, and the behavior keeps what it last accepted.
     * @param {Record<string, unknown>} bindings Values or typed bindings supplied by parameter name.
     */
    update(bindings) {
        if (this.#status === 'disposed') {
            throw DomqlError.evaluation('A disposed behavior cannot be updated', {});
        }

        const call = this.#prepare(bindings);

        if (call.declaration !== this.#declaration) {
            throw DomqlError.validation(`These bindings select the behavior '${call.name}', which is another behavior; activate it as one of its own`, call.location);
        }

        if (call.args === null) {
            // A null receiver or argument leaves nothing to activate, so the instance ends.
            this.#disposeInstance();

            return;
        }

        if (this.#instance === null) {
            this.#instance = this.#activate(call);

            return;
        }

        try {
            this.#instance.update(call.receiver, call.args);
        } catch (error) {
            throw DomqlError.evaluation(`The behavior '${call.name}' failed to update`, call.location, { cause: error });
        }
    }

    /** Ends the behavior: disposes the instance its module created, reporting a failure of that, and marks the behavior disposed whatever happened. Disposing again does nothing. */
    dispose() {
        if (this.#status === 'disposed') {
            return;
        }

        this.#status = 'disposed';
        this.#disposeInstance();
    }

    /** Has the behavior's module create its instance, which must answer how it is updated and disposed. */
    #activate({ name, activate, receiver, args, environment, location }) {
        let instance;

        try {
            instance = activate(receiver, args, environment, { reportError: this.#reportError });
        } catch (error) {
            throw DomqlError.evaluation(`The behavior '${name}' failed to activate`, location, { cause: error });
        }

        if (typeof instance?.update !== 'function' || typeof instance?.dispose !== 'function') {
            // What answered no way to update it is still let go of, where it offers a way to.
            try {
                instance?.dispose?.();
            } catch (error) {
                this.#reportError(error);
            }

            throw DomqlError.evaluation(`The behavior '${name}' activated and answered no update and dispose`, location);
        }

        return instance;
    }

    #disposeInstance() {
        const instance = this.#instance;

        this.#instance = null;

        try {
            instance?.dispose();
        } catch (error) {
            this.#reportError(error);
        }
    }
}
