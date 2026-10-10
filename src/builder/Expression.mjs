/**
 * Expression — what a build's callback works with in place of a value: a DOMQL expression, recorded as the definition node it is, to which each member read or called on it, and each shape and test written on it, adds a node
 */

import { DomqlError } from '../language/DomqlError.mjs';

export class Expression {
    /** The node each expression is, or null for the current value of a projection or an expression argument. @type {WeakMap<object, object | null>} */
    static #nodes = new WeakMap();

    /**
     * The expression the node is, recording what is read or called on it through the builder.
     * It is callable, so a member read on it can be called with arguments; it holds no value, so converting it to a number or a string is refused, and it is no promise.
     * JavaScript's operators reach no property and make no call, so they cannot be recorded: a DOMQL expression is written through property reads and calls alone.
     * @param {object | null} node The definition node it is, or null for the current value.
     * @param {import('./QueryBuilder.mjs').QueryBuilder} builder The build it records into.
     */
    static create(node, builder) {
        const expression = new Proxy(function expression() {}, {
            get: (_target, key) => Expression.#read(node, builder, key),
            apply: (_target, _receiver, args) => builder.call(node, args),
            set: () => {
                throw DomqlError.structure('An expression records the query; nothing is written on it', {});
            },
        });

        Expression.#nodes.set(expression, node);

        return expression;
    }

    /** Whether the value is an expression a build recorded. */
    static isExpression(value) {
        return Expression.#nodes.has(value);
    }

    /** The node the expression is, or null for the current value. */
    static nodeOf(expression) {
        return Expression.#nodes.get(expression);
    }

    static #read(node, builder, key) {
        if (key === Symbol.toPrimitive) {
            return () => {
                throw DomqlError.structure('An expression records the query as it is built and holds no value yet, so arithmetic, concatenation and comparisons over it are refused; a member or a shape of the query computes what it needs', {});
            };
        }

        // A symbol names no member, and an expression is no promise, so awaiting one gives it back.
        if (typeof key === 'symbol' || key === 'then') {
            return undefined;
        }

        switch (key) {
            case 'select':
                return projection => builder.select(node, projection);
            case 'is':
            case 'has':
                return names => builder.test(node, key, names);
            default:
                return Expression.create(builder.member(node, key), builder);
        }
    }
}
