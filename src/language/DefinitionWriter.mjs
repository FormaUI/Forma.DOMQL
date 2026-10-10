/**
 * DefinitionWriter — a definition's node as the DOMQL text that writes it, for a message about a query that has no text of its own
 */

export class DefinitionWriter {
    /**
     * The text that writes the node.
     * @param {object} node A node of a definition.
     */
    static write(node) {
        switch (node.kind) {
            case 'literal':
                return JSON.stringify(node.value);
            case 'parameter':
                return `@${node.name}`;
            case 'member': {
                const target = node.target === undefined ? '' : `${DefinitionWriter.write(node.target)}.`;
                const args = node.arguments.length === 0 ? '' : `(${node.arguments.map(entry => DefinitionWriter.#entry(entry)).join(', ')})`;

                return `${target}${node.name}${args}`;
            }
            case 'predicate': {
                const target = node.target === undefined ? '' : `${DefinitionWriter.write(node.target)} `;

                return `${target}${node.verb} ${DefinitionWriter.#names(node.test, null)}`;
            }
            default: {
                const target = node.target === undefined ? '' : `${DefinitionWriter.write(node.target)} `;

                return `${target}{ ${node.fields.map(entry => DefinitionWriter.#entry(entry)).join(', ')} }`;
            }
        }
    }

    static #entry(entry) {
        return entry.name === undefined ? DefinitionWriter.write(entry.value) : `${entry.name}: ${DefinitionWriter.write(entry.value)}`;
    }

    /** The names a test reads, an or inside an and in parentheses, since and binds tighter. */
    static #names(node, within) {
        if (node.kind !== 'and' && node.kind !== 'or') {
            return DefinitionWriter.write(node);
        }

        const text = node.operands.map(operand => DefinitionWriter.#names(operand, node.kind)).join(` ${node.kind} `);

        return within === 'and' && node.kind === 'or' ? `(${text})` : text;
    }
}
