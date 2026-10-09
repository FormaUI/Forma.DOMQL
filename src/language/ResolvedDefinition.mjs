/**
 * ResolvedDefinition — a definition resolved against the vocabulary: its request kind, the type of its answer, and what each of its nodes resolved to
 */

export class ResolvedDefinition {
    #definition;
    #kind;
    #type;
    #resolutions;
    #usedMembers;

    /**
     * @param {object} definition The request's definition.
     * @param {'query' | 'subscription' | 'action' | 'behavior'} kind The request's kind.
     * @param {import('./Type.mjs').Type} type The type of its answer.
     * @param {Map<string, object>} resolutions What each member node, by its JSON Pointer, resolved to.
     * @param {object[]} usedMembers The declarations the request uses, each with the pointer that used it.
     */
    constructor(definition, kind, type, resolutions, usedMembers) {
        this.#definition = definition;
        this.#kind = kind;
        this.#type = type;
        this.#resolutions = resolutions;
        this.#usedMembers = Object.freeze([...usedMembers]);
    }

    /** The request's definition. */
    get definition() {
        return this.#definition;
    }

    /** The request's kind: a query, a subscription, an action or a behavior request. */
    get kind() {
        return this.#kind;
    }

    /** The type of the request's answer. */
    get type() {
        return this.#type;
    }

    /** The declarations the request uses, with where each is used. */
    get usedMembers() {
        return this.#usedMembers;
    }

    /** What the member node at the pointer resolved to. */
    getResolution(pointer) {
        return this.#resolutions.get(pointer);
    }
}
