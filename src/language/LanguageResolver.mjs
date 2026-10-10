/**
 * LanguageResolver — resolves a DOMQL definition against the vocabulary and validates its types, before anything is evaluated
 */

import { DomqlError } from './DomqlError.mjs';
import { Names } from './Names.mjs';
import { ResolvedDefinition } from './ResolvedDefinition.mjs';
import { Type } from './Type.mjs';

const DATA = new Set(['number', 'string', 'boolean']);
const READABLE = new Set(['property', 'operation']);

export class LanguageResolver {
    #registry;
    #bindings;
    #locations;
    #options;

    /** @type {Map<string, object>} */
    #resolutions = new Map();

    /** @type {object[]} */
    #used = [];

    /**
     * @param {import('./vocabulary/ModuleRegistry.mjs').ModuleRegistry} registry The vocabulary to resolve against.
     * @param {import('./ParameterBindings.mjs').ParameterBindings} bindings What the request's parameters are bound to.
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
    resolveDefinition(definition) {
        const result = this.#node(definition.query, '/query', { current: null });

        const resultType = result.kind === 'subscription' && result.type.kind === 'occurrence' ? result.type.item : result.type;

        if (result.kind !== 'behavior' && !this.#isData(resultType)) {
            this.#fail(`The result would hold ${resultType}, which is no data; shape it into the facts it needs`, '/query');
        }

        if (this.#options.watch === true && result.kind === 'query') {
            this.#checkWatch();
        }

        return new ResolvedDefinition(definition, result.kind, result.type, this.#resolutions, this.#used);
    }

    #node(node, pointer, scope) {
        switch (node.kind) {
            case 'literal':
                return this.#literal(node);
            case 'parameter':
                return this.#parameter(node, pointer);
            case 'member':
                return this.#member(node, pointer, scope);
            case 'predicate':
                return this.#test(node, pointer, scope);
            default:
                return this.#shape(node, pointer, scope);
        }
    }

    /** Resolves a test: its subject, and every predicate name it reads, each under its verb and against the subject's type. */
    #test(node, pointer, scope) {
        const { verb } = node;
        const subject = node.target === undefined ? { type: scope.current, kind: 'query' } : this.#node(node.target, `${pointer}/target`, scope);

        if (subject.type === null) {
            this.#fail(`'${verb}' without a subject tests the current value, and there is none here`, pointer);
        }

        if (subject.kind !== 'query') {
            this.#fail(`'${verb}' tests ${LanguageResolver.#nameOf(subject.kind)}, which is no value`, pointer);
        }

        if (subject.type.kind === 'null') {
            this.#fail(`'${verb}' tests null, which no predicate applies to`, pointer);
        }

        this.#resolveNames(node.test, `${pointer}/test`, verb, subject.type);

        const type = Type.named('boolean');

        return { type: subject.type.isNullable ? type.toNullable() : type, kind: 'query', isFixed: false };
    }

    /** Resolves each predicate name a test reads, every branch of an and or an or included, so a test is validated whole before any of it is evaluated. */
    #resolveNames(node, pointer, verb, subjectType) {
        if (node.kind === 'and' || node.kind === 'or') {
            node.operands.forEach((operand, index) => this.#resolveNames(operand, `${pointer}/operands/${index}`, verb, subjectType));

            return;
        }

        const named = this.#node(node, pointer, { current: null });

        if (!named.isFixed || typeof named.value !== 'string') {
            this.#fail(`A predicate '${verb}' reads is named by a string, or a parameter bound to a string, never null`, pointer);
        }

        const name = named.value;
        const predicate = this.#registry.getPredicate(verb, name);

        if (predicate === undefined || !LanguageResolver.#matchesAny(predicate.on, subjectType)) {
            this.#fail(`'${verb} "${name}"' is no predicate of ${subjectType.toNonNullable()}; '${verb}' reads ${this.#registry.getPredicateNames(verb).join(', ')}`, pointer);
        }

        this.#resolutions.set(pointer, { kind: 'predicate', predicate });
        this.#used.push({ declaration: { name: `${verb} ${name}`, changes: predicate.changes, reads: predicate.reads, misses: predicate.misses }, pointer });
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

        return { type: LanguageResolver.#toType(this.#bindings.typeOf(node.name)), kind: 'query', isFixed: true, value: this.#bindings.get(node.name) };
    }

    #member(node, pointer, scope) {
        const receiver = node.target === undefined ? { type: scope.current, kind: 'query' } : this.#node(node.target, `${pointer}/target`, scope);
        const receiverType = receiver.type;

        if (receiverType === null) {
            this.#fail(`'${node.name}' is a member of the current value, and there is none here`, pointer);
        }

        if (receiver.kind !== 'query') {
            this.#fail(`'${node.name}' follows ${LanguageResolver.#nameOf(receiver.kind)}, which takes no members`, pointer);
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

        const declaration = candidates.find(candidate => LanguageResolver.#matchesReceiver(candidate, receiverType, new Map()));

        if (declaration === undefined) {
            this.#fail(`'${node.name}' is not available on ${receiverType.toNonNullable()}; it is available on ${candidates.flatMap(candidate => [candidate.on].flat()).join(', ')}`, pointer);
        }

        const matched = new Map();
        LanguageResolver.#matchesReceiver(declaration, receiverType, matched);

        const resolved = this.#resolveArguments(declaration, node, pointer, scope, receiverType, matched);

        const variables = new Map(matched);

        if (resolved.selected !== undefined) {
            variables.set('@selected', resolved.selected.type);
        }

        const declared = Type.substitute(Type.parse(declaration.result), variables);

        this.#used.push({ declaration, pointer });
        this.#resolutions.set(pointer, { kind: 'member', declaration, receiverType, type: declared, arguments: resolved.arguments, selected: resolved.selected, steps: resolved.steps });

        const type = receiverType.isNullable || resolved.isNullable ? declared.toNullable() : declared;

        return { type, kind: LanguageResolver.#kindOf(declaration), isFixed: false };
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
        let steps;

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
                steps = selection.steps ?? steps;
            }

            resolved.push({ parameter, isDefault: false, pointer: valuePointer, node: given.argument.value, value: parameter.fixed === true ? result.value : undefined });
        }

        return { arguments: resolved, isNullable, selected, steps };
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
            this.#fail(`The argument '${parameter.name}' of '${declaration.name}' is ${LanguageResolver.#nameOf(result.kind)}, and an argument is a value`, pointer);
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
                return this.#selectMember(receiverType, name, pointer);
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
        const steps = [];

        for (const segment of path.split('.')) {
            isNullable ||= current.isNullable;

            const field = this.#getField(current, segment);

            if (field !== null) {
                steps.push({ kind: 'field', name: segment });
                current = field;
                isNullable ||= field.isNullable;
                continue;
            }

            const declaration = this.#registry.getMembers(segment).find(candidate => READABLE.has(candidate.kind) && candidate.parameters.every(parameter => !parameter.required) && LanguageResolver.#matchesReceiver(candidate, current, new Map()));

            if (declaration === undefined) {
                this.#fail(`'${segment}' names no property or operation of ${current.toNonNullable()} that reads without arguments`, pointer);
            }

            const matched = new Map();
            LanguageResolver.#matchesReceiver(declaration, current, matched);
            current = Type.substitute(Type.parse(declaration.result), matched);
            steps.push({ kind: 'member', declaration, type: current });
            isNullable ||= current.isNullable;
            this.#used.push({ declaration, pointer });
        }

        return { selected: { name: path, type: isNullable ? current.toNullable() : current }, steps };
    }

    #shape(node, pointer, scope) {
        const target = node.target === undefined ? null : this.#node(node.target, `${pointer}/target`, scope);

        if (target?.kind === 'behavior') {
            this.#fail('A behavior request ends its path and takes no shape', pointer);
        }

        // A shape that follows an action shapes its result, and the request stays an action.
        const kind = target?.kind === 'action' ? 'action' : 'query';

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
                this.#fail(`The field '${name}' is ${LanguageResolver.#nameOf(result.kind)}, and a field is a value`, `${fieldPointer}/value`);
            }

            if (!this.#isData(result.type)) {
                this.#fail(`The field '${name}' would hold ${result.type}, which is no data; shape it into the facts it needs`, `${fieldPointer}/value`);
            }

            fields.set(name, result.type);
        });

        const shape = Type.shape(fields);
        const isNullable = target?.type.isNullable === true;

        if (target?.type.kind === 'list') {
            return { type: Type.list(shape, isNullable), kind, isFixed: false };
        }

        if (target?.type.kind === 'occurrence') {
            return { type: Type.occurrence(shape, isNullable), kind: 'subscription', isFixed: false };
        }

        return { type: isNullable ? shape.toNullable() : shape, kind, isFixed: false };
    }

    #checkWatch() {
        const unobserved = this.#used.filter(use => use.declaration.changes === 'unobserved');

        if (unobserved.length > 0) {
            this.#fail(`A watch cannot follow ${unobserved.map(use => `'${use.declaration.name}'`).join(', ')}, which name no observations`, unobserved[0].pointer);
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

    /** What a request of the kind is, for a message: a subscription is an occurrence source. */
    static #nameOf(kind) {
        switch (kind) {
            case 'subscription':
                return 'an occurrence source';
            case 'action':
                return 'an action';
            default:
                return `a ${kind}`;
        }
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
        return LanguageResolver.#matchesAny(declaration.on, receiverType, bindings);
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
                type = Type.list(LanguageResolver.#toType(binding.item));
                break;
            case 'object':
                type = Type.shape(new Map([...binding.fields].map(([name, field]) => [name, LanguageResolver.#toType(field)])));
                break;
            default:
                type = Type.named(binding.kind);
        }

        return binding.isNullable ? type.toNullable() : type;
    }
}
