/**
 * DefinitionInterning — one definition object for each definition content a build produces, so the queries built alike share it and, with it, their resolution
 */

export class DefinitionInterning {
    /** The definition kept for each content, held weakly: valid while a query holds it, and released with the last one. @type {Map<string, WeakRef<object>>} */
    static #definitions = new Map();

    /** Forgets a content once its definition is released. */
    static #released = new FinalizationRegistry(content => {
        if (DefinitionInterning.#definitions.get(content)?.deref() === undefined) {
            DefinitionInterning.#definitions.delete(content);
        }
    });

    /**
     * The definition kept for the content of this one, or this one, kept, where none is.
     * @param {object} definition A validated, frozen definition.
     */
    static intern(definition) {
        const content = JSON.stringify(definition);
        const kept = DefinitionInterning.#definitions.get(content)?.deref();

        if (kept !== undefined) {
            return kept;
        }

        DefinitionInterning.#definitions.set(content, new WeakRef(definition));
        DefinitionInterning.#released.register(definition, content);

        return definition;
    }
}
