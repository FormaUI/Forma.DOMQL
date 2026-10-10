/**
 * ResolvedDefinition — a definition resolved against the vocabulary: its request kind, the type of its result, and what each of its nodes resolved to
 */

export class ResolvedDefinition {
    #definition;
    #kind;
    #type;
    #resolutions;
    #usedMembers;

    /** Each node of the definition's query, by the node itself, with its JSON Pointer and what it resolved to. @type {Map<object, { pointer: string, resolution: object | undefined }>} */
    #nodes = new Map();

    /**
     * @param {object} definition The request's definition, whose every node is an object of its own.
     * @param {'query' | 'subscription' | 'action' | 'behavior'} kind The request's kind.
     * @param {import('./Type.mjs').Type} type The type of its result.
     * @param {Map<string, object>} resolutions What each member node, by its JSON Pointer, resolved to.
     * @param {object[]} usedMembers The declarations the request uses, each with the pointer that used it.
     */
    constructor(definition, kind, type, resolutions, usedMembers) {
        this.#definition = definition;
        this.#kind = kind;
        this.#type = type;
        this.#resolutions = resolutions;
        this.#usedMembers = Object.freeze([...usedMembers]);
        this.#index(definition.query, '/query');
    }

    /** The request's definition. */
    get definition() {
        return this.#definition;
    }

    /** The request's kind: a query, a subscription, an action or a behavior request. */
    get kind() {
        return this.#kind;
    }

    /** The type of the request's result. */
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

    /**
     * What the node of the definition resolved to.
     * @internal
     */
    resolutionOf(node) {
        return this.#nodes.get(node)?.resolution;
    }

    /**
     * The JSON Pointer of the node of the definition.
     * @internal
     */
    pointerOf(node) {
        return this.#nodes.get(node)?.pointer;
    }

    /** Records the node at the pointer and every node beneath it, each with its pointer and its resolution. */
    #index(node, pointer) {
        this.#nodes.set(node, { pointer, resolution: this.#resolutions.get(pointer) });

        if (node.target !== undefined) {
            this.#index(node.target, `${pointer}/target`);
        }

        switch (node.kind) {
            case 'member':
                node.arguments.forEach((argument, index) => this.#index(argument.value, `${pointer}/arguments/${index}/value`));
                break;
            case 'shape':
                node.fields.forEach((field, index) => this.#index(field.value, `${pointer}/fields/${index}/value`));
                break;
            case 'predicate':
                this.#index(node.test, `${pointer}/test`);
                break;
            case 'and':
            case 'or':
                node.operands.forEach((operand, index) => this.#index(operand, `${pointer}/operands/${index}`));
                break;
        }
    }
}
