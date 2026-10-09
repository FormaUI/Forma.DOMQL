/**
 * DomqlQuery — a DOMQL query: its definition and the values its parameters are bound to
 */

/** @typedef {import('./Bindings.mjs').Bindings} Bindings */

export class DomqlQuery {
    #definition;
    #bindings;

    /**
     * @param {object} definition The query's validated, frozen definition.
     * @param {Bindings} bindings The values its parameters are bound to.
     */
    constructor(definition, bindings) {
        this.#definition = definition;
        this.#bindings = bindings;
    }

    /** The query's definition, without its bound values. */
    get definition() {
        return this.#definition;
    }

    /** The values the query's parameters are bound to. */
    get bindings() {
        return this.#bindings;
    }
}
