/**
 * DefinitionValidator — a definition checked against DOMQL's structure, as its canonical, frozen copy
 */

import { DomqlError } from './DomqlError.mjs';
import { Names } from './Names.mjs';
import { Specification } from './Specification.mjs';

/** @typedef {import('./TextLocations.mjs').TextLocations} TextLocations */

/** The properties each kind of node holds, and those it requires. */
const NODES = {
    literal: { properties: ['kind', 'value'], required: ['value'] },
    parameter: { properties: ['kind', 'name'], required: ['name'] },
    member: { properties: ['kind', 'target', 'name', 'arguments'], required: ['name', 'arguments'] },
    shape: { properties: ['kind', 'target', 'fields'], required: ['fields'] },
};

const ENTRY = { properties: ['name', 'value'], required: ['value'] };

/** Where a node's current value stands: absent at the top level, present in a shape following a value, unknown in an argument. */
const Scope = Object.freeze({ absent: 'absent', present: 'present', unknown: 'unknown' });

export class DefinitionValidator {
    #locations;

    /** @param {TextLocations | null} locations Where in a text each part of the definition came from, for one parsed from text. */
    constructor(locations = null) {
        this.#locations = locations;
    }

    /** Checks the definition's structure, returning its canonical, frozen copy. */
    validate(definition) {
        this.#requireProperties(definition, '', { properties: ['version', 'query'], required: ['version', 'query'] });

        if (definition.version !== Specification.definitionVersion) {
            this.#fail('/version', `A definition is of version ${Specification.definitionVersion}`);
        }

        return Object.freeze({ version: Specification.definitionVersion, query: this.#validateNode(definition.query, '/query', Scope.absent) });
    }

    #validateNode(node, pointer, scope) {
        if (!DefinitionValidator.#isObject(node) || !Object.hasOwn(NODES, node.kind)) {
            this.#fail(pointer, 'A node is an object whose kind is literal, parameter, member or shape');
        }

        this.#requireProperties(node, pointer, NODES[node.kind]);

        switch (node.kind) {
            case 'literal':
                return this.#validateLiteral(node, pointer);
            case 'parameter':
                this.#requireName(node.name, `${pointer}/name`);

                return Object.freeze({ kind: 'parameter', name: node.name });
            case 'member':
                return this.#validateMember(node, pointer, scope);
            default:
                return this.#validateShape(node, pointer, scope);
        }
    }

    #validateLiteral(node, pointer) {
        const { value } = node;

        if (value !== null && typeof value !== 'string' && typeof value !== 'boolean' && !Number.isFinite(value)) {
            this.#fail(`${pointer}/value`, 'A literal is a string, a finite number, a Boolean or null');
        }

        return Object.freeze({ kind: 'literal', value });
    }

    #validateMember(node, pointer, scope) {
        this.#requireName(node.name, `${pointer}/name`);

        const target = node.target === undefined ? undefined : this.#validateNode(node.target, `${pointer}/target`, scope);

        if (target === undefined && scope === Scope.absent) {
            this.#fail(pointer, `'${node.name}' is a member of the current value, and the top level has none; a path there starts with a parameter, a literal or a shape`);
        }

        this.#requireArray(node.arguments, `${pointer}/arguments`);

        let isNamed = false;

        /** @type {Set<string>} */
        const argumentNames = new Set();

        const entries = node.arguments.map((argument, index) => {
            const argumentPointer = `${pointer}/arguments/${index}`;
            this.#requireProperties(argument, argumentPointer, ENTRY);

            if (argument.name !== undefined) {
                this.#requireName(argument.name, `${argumentPointer}/name`);
                isNamed = true;

                if (argumentNames.has(argument.name)) {
                    this.#fail(argumentPointer, `Two arguments of one call are named '${argument.name}'`);
                }

                argumentNames.add(argument.name);
            } else if (isNamed) {
                this.#fail(argumentPointer, 'Arguments given by position come before those given by name');
            }

            const value = this.#validateNode(argument.value, `${argumentPointer}/value`, Scope.unknown);

            return Object.freeze(argument.name === undefined ? { value } : { name: argument.name, value });
        });

        return Object.freeze(target === undefined
            ? { kind: 'member', name: node.name, arguments: Object.freeze(entries) }
            : { kind: 'member', target, name: node.name, arguments: Object.freeze(entries) });
    }

    #validateShape(node, pointer, scope) {
        const target = node.target === undefined ? undefined : this.#validateNode(node.target, `${pointer}/target`, scope);

        this.#requireArray(node.fields, `${pointer}/fields`);

        if (node.fields.length === 0) {
            this.#fail(pointer, 'A shape names at least one field');
        }

        const fieldScope = target === undefined ? scope : Scope.present;

        /** @type {Set<string>} */
        const names = new Set();

        const fields = node.fields.map((field, index) => {
            const fieldPointer = `${pointer}/fields/${index}`;
            this.#requireProperties(field, fieldPointer, ENTRY);

            if (field.name !== undefined) {
                this.#requireName(field.name, `${fieldPointer}/name`);
            }

            const value = this.#validateNode(field.value, `${fieldPointer}/value`, fieldScope);
            const name = field.name ?? Names.inferField(value);

            if (name === null) {
                this.#fail(fieldPointer, 'This field infers no name and takes one of its own: a parameter, a literal or a shape alone names nothing, and nor does a get, is or has of a bound name');
            }

            if (names.has(name)) {
                this.#fail(fieldPointer, `Two fields of one shape are named '${name}'`);
            }

            names.add(name);

            return Object.freeze(field.name === undefined ? { value } : { name: field.name, value });
        });

        return Object.freeze(target === undefined
            ? { kind: 'shape', fields: Object.freeze(fields) }
            : { kind: 'shape', target, fields: Object.freeze(fields) });
    }

    #requireProperties(part, pointer, { properties, required }) {
        if (!DefinitionValidator.#isObject(part)) {
            this.#fail(pointer, 'This part of a definition is an object');
        }

        for (const key of Object.keys(part)) {
            if (!properties.includes(key)) {
                this.#fail(pointer, `'${key}' is no property of this part of a definition`);
            }
        }

        for (const key of required) {
            if (!Object.hasOwn(part, key)) {
                this.#fail(pointer, `This part of a definition requires '${key}'`);
            }
        }
    }

    #requireArray(value, pointer) {
        if (!Array.isArray(value)) {
            this.#fail(pointer, 'This part of a definition is an array');
        }
    }

    #requireName(value, pointer) {
        if (!Names.isName(value)) {
            this.#fail(pointer, 'A name is a letter followed by letters and digits, with single hyphens between them, and never true, false or null');
        }
    }

    #fail(pointer, message) {
        throw DomqlError.structure(message, this.#locations?.locate(pointer) ?? { pointer });
    }

    static #isObject(value) {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }
}
