/**
 * RequestResolver — resolves a definition against the vocabulary and types it, before anything is evaluated
 */

import { DomqlError } from './DomqlError.mjs';
import { Names } from './Names.mjs';
import { ResolvedRequest } from './ResolvedRequest.mjs';
import { Type } from './Type.mjs';

const DATA = new Set(['number', 'string', 'boolean']);
const READABLE = new Set(['property', 'operation']);

export class RequestResolver {
    #registry;
    #bindings;
    #locations;
    #options;

    /** @type {Map<string, object>} */
    #resolutions = new Map();

    /** @type {object[]} */
    #used = [];

    /**
     * @param {import('./Registry.mjs').Registry} registry The vocabulary to resolve against.
     * @param {import('./Bindings.mjs').Bindings} bindings What the request's parameters are bound to.
     * @param {import('./TextLocations.mjs').TextLocations | null} locations Where in a text each part of the definition came from.
     * @param {{ watch?: boolean, acceptPartialObservation?: boolean }} options How the request will be carried out.
     */
    constructor(registry, bindings, locations, options) {
        this.#registry = registry;
        this.#bindings = bindings;
        this.#locations = locations;
        this.#options = options;
    }

    /** Resolves and types the definition, answering what it resolved to or throwing where it cannot. */
    resolve(definition) {
        const result = this.#node(definition.query, '/query', { current: null });

        const answer = result.kind === 'subscription' && result.type.kind === 'occurrence' ? result.type.item : result.type;

        if ((result.kind === 'query' || result.kind === 'subscription') && !this.#isData(answer)) {
            this.#fail(`The answer would hold ${answer}, which is no data; shape it into the facts it needs`, '/query');
        }

        if (this.#options.watch === true && result.kind === 'query') {
            this.#checkWatch();
        }

        return new ResolvedRequest(definition, result.kind, result.type, this.#resolutions, this.#used);
    }

    #node(node, pointer, scope) {
        switch (node.kind) {
            case 'literal':
                return this.#literal(node);
            case 'parameter':
                return this.#parameter(node, pointer);
            case 'member':
                return this.#member(node, pointer, scope);
            default:
                return this.#shape(node, pointer, scope);
        }
    }

    #literal(node) {
        const { value } = node;
        const type = value === null ? Type.null : Type.named(typeof value);

        return { type, kind: 'query', isFixed: true, value };
    }

    #parameter(node, pointer) {
        if (node.name === 'document' || node.name === 'window') {
            return { type: Type.named(node.name), kind: 'query', isFixed: false };
        }

        if (!this.#bindings.has(node.name)) {
            this.#fail(`The parameter '@${node.name}' is not bound`, pointer);
        }

        return { type: RequestResolver.#toType(this.#bindings.typeOf(node.name)), kind: 'query', isFixed: true, value: this.#bindings.get(node.name) };
    }

    #member(node, pointer, scope) {
        const receiver = node.target === undefined ? { type: scope.current, kind: 'query' } : this.#node(node.target, `${pointer}/target`, scope);
        const receiverType = receiver.type;

        if (receiverType === null) {
            this.#fail(`'${node.name}' is a member of the current value, and there is none here`, pointer);
        }

        if (receiver.kind !== 'query') {
            this.#fail(`'${node.name}' follows ${receiver.kind === 'subscription' ? 'an occurrence source' : `an ${receiver.kind}`}, which takes no members`, pointer);
        }

        if (receiverType.kind === 'null') {
            this.#fail(`'${node.name}' follows null, which has no members`, pointer);
        }

        const field = this.#getField(receiverType, node.name);

        if (field !== null) {
            if (node.arguments.length > 0) {
                this.#fail(`'${node.name}' is a field of ${receiverType.toNonNullable()} and takes no arguments`, pointer);
            }

            this.#resolutions.set(pointer, { kind: 'field', name: node.name, receiverType });

            return { type: receiverType.isNullable ? field.toNullable() : field, kind: 'query', isFixed: false };
        }

        const candidates = this.#registry.getMembers(node.name);

        if (candidates.length === 0) {
            this.#fail(`'${node.name}' is no member of the vocabulary`, pointer);
        }

        const declaration = candidates.find(candidate => RequestResolver.#matchesReceiver(candidate, receiverType, new Map()));

        if (declaration === undefined) {
            this.#fail(`'${node.name}' is not available on ${receiverType.toNonNullable()}; it is available on ${candidates.flatMap(candidate => [candidate.on].flat()).join(', ')}`, pointer);
        }

        const matched = new Map();
        RequestResolver.#matchesReceiver(declaration, receiverType, matched);

        const resolved = this.#resolveArguments(declaration, node, pointer, scope, receiverType, matched);

        this.#used.push({ declaration, pointer });
        this.#resolutions.set(pointer, { kind: 'member', declaration, receiverType, arguments: resolved.arguments, selected: resolved.selected });

        if (resolved.predicate !== undefined) {
            this.#used.push({ declaration: { name: `${declaration.name} ${resolved.predicate.name}`, changes: resolved.predicate.changes, reads: resolved.predicate.reads, misses: resolved.predicate.misses }, pointer });
        }

        const variables = new Map(matched);

        if (resolved.selected !== undefined) {
            variables.set('@selected', resolved.selected.type);
        }

        let type = Type.substitute(Type.parse(declaration.result), variables);

        if (receiverType.isNullable || resolved.isNullable) {
            type = type.toNullable();
        }

        return { type, kind: RequestResolver.#kindOf(declaration), isFixed: false };
    }

    #resolveArguments(declaration, node, pointer, scope, receiverType, matched) {
        const parameters = declaration.parameters;
        const supplied = new Map();
        let position = 0;

        node.arguments.forEach((argument, index) => {
            const argumentPointer = `${pointer}/arguments/${index}`;
            let parameter;

            if (argument.name === undefined) {
                parameter = parameters[position++];

                if (parameter === undefined) {
                    this.#fail(`'${declaration.name}' takes ${parameters.length} ${parameters.length === 1 ? 'argument' : 'arguments'} and is given more`, argumentPointer);
                }
            } else {
                parameter = parameters.find(candidate => candidate.name === argument.name);

                if (parameter === undefined) {
                    this.#fail(`'${declaration.name}' has no parameter '${argument.name}'`, argumentPointer);
                }
            }

            if (supplied.has(parameter.name)) {
                this.#fail(`The argument '${parameter.name}' of '${declaration.name}' is given twice`, argumentPointer);
            }

            supplied.set(parameter.name, { argument, pointer: argumentPointer });
        });

        const resolved = [];
        let isNullable = false;
        let selected;
        let predicate;

        for (const parameter of parameters) {
            const given = supplied.get(parameter.name);

            if (given === undefined) {
                if (parameter.required) {
                    this.#fail(`'${declaration.name}' requires the argument '${parameter.name}'`, pointer);
                }

                resolved.push({ parameter, isDefault: true, value: parameter.default });
                continue;
            }

            const valuePointer = `${given.pointer}/value`;
            const expected = Type.substitute(Type.parse(parameter.type), matched);
            let result;

            if (parameter.kind === 'expression') {
                if (receiverType.kind !== 'list') {
                    this.#fail(`'${declaration.name}' evaluates its expression against the items of a list, and ${receiverType.toNonNullable()} has none`, valuePointer);
                }

                result = this.#node(given.argument.value, valuePointer, { current: receiverType.item.toNonNullable() });
                this.#requireQuery(result, parameter, declaration, valuePointer);

                if (!Type.isAssignable(result.type, expected)) {
                    this.#fail(`The expression of '${declaration.name}' must produce ${expected} and produces ${result.type}`, valuePointer);
                }
            } else {
                result = this.#node(given.argument.value, valuePointer, scope);
                this.#requireQuery(result, parameter, declaration, valuePointer);

                if (!this.#checkValue(result, expected, parameter, declaration, valuePointer)) {
                    isNullable = true;
                }
            }

            if (parameter.fixed === true) {
                const selection = this.#select(parameter, result, declaration, receiverType, valuePointer);

                selected = selection.selected ?? selected;
                predicate = selection.predicate ?? predicate;
            }

            resolved.push({ parameter, isDefault: false, pointer: valuePointer });
        }

        return { arguments: resolved, isNullable, selected, predicate };
    }

    /** Checks a value argument against its parameter, answering false where a null makes the call answer null. */
    #checkValue(result, expected, parameter, declaration, pointer) {
        const actual = result.type;
        const wrong = () => this.#fail(`The argument '${parameter.name}' of '${declaration.name}' expects ${expected} and finds ${actual}`, pointer);

        if (actual.kind === 'null') {
            if (expected.isNullable) {
                return true;
            }

            if (parameter.nulls === 'propagate') {
                return false;
            }

            wrong();
        }

        if (parameter.nulls === 'propagate') {
            if (!Type.isAssignable(actual.toNonNullable(), expected.toNonNullable())) {
                wrong();
            }

            return !actual.isNullable;
        }

        if (!Type.isAssignable(actual, expected)) {
            wrong();
        }

        return true;
    }

    #requireQuery(result, parameter, declaration, pointer) {
        if (result.kind !== 'query') {
            this.#fail(`The argument '${parameter.name}' of '${declaration.name}' is ${result.kind === 'subscription' ? 'an occurrence source' : `an ${result.kind}`}, and an argument is a value`, pointer);
        }
    }

    /** Resolves what a fixed argument selects from the vocabulary, which must be known before anything is evaluated. */
    #select(parameter, result, declaration, receiverType, pointer) {
        if (!result.isFixed || typeof result.value !== 'string') {
            this.#fail(`The argument '${parameter.name}' of '${declaration.name}' selects from the vocabulary, so it is a string literal or a parameter bound to a string, never null`, pointer);
        }

        const name = result.value;

        switch (parameter.selects) {
            case 'member':
                return { selected: { name, type: this.#selectMember(receiverType, name, pointer) } };
            case 'predicate': {
                const predicate = this.#registry.getPredicate(declaration.name, name);

                if (predicate === undefined || !RequestResolver.#matchesAny(predicate.on, receiverType)) {
                    const available = this.#registry.getPredicateNames(declaration.name).join(', ');

                    this.#fail(`'${declaration.name} "${name}"' is no predicate of ${receiverType.toNonNullable()}; '${declaration.name}' reads ${available}`, pointer);
                }

                return { selected: { name, type: Type.named('boolean') }, predicate };
            }
            case 'occurrence': {
                const event = this.#registry.getEvent(name);

                if (event === undefined) {
                    this.#fail(`'${name}' is no event type the vocabulary declares`, pointer);
                }

                return { selected: { name, type: Type.parse(event.payload) } };
            }
            default:
                if (!this.#registry.hasFeature(name)) {
                    this.#fail(`'${name}' is no feature the vocabulary declares`, pointer);
                }

                return { selected: { name, type: Type.named('string') } };
        }
    }

    /** Resolves the path a get names, each segment against the type before it, answering the type of the last. */
    #selectMember(receiverType, path, pointer) {
        let current = receiverType;
        let isNullable = false;

        for (const segment of path.split('.')) {
            isNullable ||= current.isNullable;

            const field = this.#getField(current, segment);

            if (field !== null) {
                current = field;
                isNullable ||= field.isNullable;
                continue;
            }

            const declaration = this.#registry.getMembers(segment).find(candidate => READABLE.has(candidate.kind) && candidate.parameters.every(parameter => !parameter.required) && RequestResolver.#matchesReceiver(candidate, current, new Map()));

            if (declaration === undefined) {
                this.#fail(`'${segment}' names no property or operation of ${current.toNonNullable()} that reads without arguments`, pointer);
            }

            const matched = new Map();
            RequestResolver.#matchesReceiver(declaration, current, matched);
            current = Type.substitute(Type.parse(declaration.result), matched);
            isNullable ||= current.isNullable;
            this.#used.push({ declaration, pointer });
        }

        return isNullable ? current.toNullable() : current;
    }

    #shape(node, pointer, scope) {
        const target = node.target === undefined ? null : this.#node(node.target, `${pointer}/target`, scope);

        if (target?.kind === 'action' || target?.kind === 'behavior') {
            this.#fail(`A ${target.kind} request ends its path and takes no shape`, pointer);
        }

        let current = scope.current;

        if (target !== null) {
            if (target.type.kind === 'null') {
                this.#fail('A shape follows null, which has no value to shape', pointer);
            }

            current = target.type.kind === 'list' || target.type.kind === 'occurrence' ? target.type.item.toNonNullable() : target.type.toNonNullable();
        }

        const fields = new Map();

        node.fields.forEach((field, index) => {
            const fieldPointer = `${pointer}/fields/${index}`;
            const name = field.name ?? Names.inferField(field.value);
            const result = this.#node(field.value, `${fieldPointer}/value`, { current });

            if (result.kind !== 'query') {
                this.#fail(`The field '${name}' is ${result.kind === 'subscription' ? 'an occurrence source' : `an ${result.kind}`}, and a field is a value`, `${fieldPointer}/value`);
            }

            if (!this.#isData(result.type)) {
                this.#fail(`The field '${name}' would hold ${result.type}, which is no data; shape it into the facts it needs`, `${fieldPointer}/value`);
            }

            fields.set(name, result.type);
        });

        const shape = Type.shape(fields);
        const isNullable = target?.type.isNullable === true;

        if (target?.type.kind === 'list') {
            return { type: Type.list(shape, isNullable), kind: 'query', isFixed: false };
        }

        if (target?.type.kind === 'occurrence') {
            return { type: Type.occurrence(shape, isNullable), kind: 'subscription', isFixed: false };
        }

        return { type: isNullable ? shape.toNullable() : shape, kind: 'query', isFixed: false };
    }

    #checkWatch() {
        const unobserved = this.#used.filter(use => use.declaration.changes === 'unobserved');

        if (unobserved.length > 0) {
            this.#fail(`A watch cannot follow ${unobserved.map(use => `'${use.declaration.name}'`).join(', ')}, which name no change sources`, unobserved[0].pointer);
        }

        const partly = this.#used.filter(use => use.declaration.changes === 'partly-observable');

        if (partly.length > 0 && this.#options.acceptPartialObservation !== true) {
            const members = [...new Map(partly.map(use => [use.declaration.name, use.declaration.misses])).entries()];

            this.#fail(`A watch over ${members.map(([name, misses]) => `'${name}' (which misses ${misses})`).join(', ')} is refused unless the watch accepts partial observation`, partly[0].pointer);
        }
    }

    /** The field a structured or shaped type declares under the name, or null. */
    #getField(type, name) {
        if (type.kind === 'shape') {
            return type.fields.get(name) ?? null;
        }

        const structure = type.kind === 'named' ? this.#registry.getType(type.name) : undefined;
        const text = structure?.fields[name];

        return text === undefined ? null : Type.parse(text);
    }

    #isData(type) {
        switch (type.kind) {
            case 'null':
                return true;
            case 'list':
                return this.#isData(type.item);
            case 'shape':
                return [...type.fields.values()].every(field => this.#isData(field));
            case 'named': {
                if (DATA.has(type.name)) {
                    return true;
                }

                const structure = this.#registry.getType(type.name);

                return structure !== undefined && Object.values(structure.fields).every(text => this.#isData(Type.parse(text)));
            }
            default:
                return false;
        }
    }

    #fail(message, pointer) {
        throw DomqlError.validation(message, this.#locations?.locate(pointer) ?? { pointer });
    }

    static #kindOf(declaration) {
        switch (declaration.kind) {
            case 'source':
                return 'subscription';
            case 'action':
            case 'behavior':
                return declaration.kind;
            default:
                return 'query';
        }
    }

    /** Whether the declaration applies to the receiver, binding the variables its types write. */
    static #matchesReceiver(declaration, receiverType, bindings) {
        return RequestResolver.#matchesAny(declaration.on, receiverType, bindings);
    }

    static #matchesAny(on, receiverType, bindings = new Map()) {
        const base = receiverType.toNonNullable();

        return [on].flat().some(text => {
            if (text === 'any') {
                return base.kind === 'named' || base.kind === 'list' || base.kind === 'shape';
            }

            return Type.unify(Type.parse(text), base, bindings);
        });
    }

    static #toType(binding) {
        let type;

        switch (binding.kind) {
            case 'list':
                type = Type.list(RequestResolver.#toType(binding.item));
                break;
            case 'object':
                type = Type.shape(new Map([...binding.fields].map(([name, field]) => [name, RequestResolver.#toType(field)])));
                break;
            default:
                type = Type.named(binding.kind);
        }

        return binding.isNullable ? type.toNullable() : type;
    }
}
