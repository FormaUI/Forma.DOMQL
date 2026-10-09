import { describe, it, expect } from 'vitest';
import { Domql } from '#domql/domql.js';
import { DomqlError } from '#domql/language/DomqlError.mjs';
import { DomqlModule } from '#domql/language/DomqlModule.mjs';

const panel = document.createElement('div');

const prepare = (text, bindings = { panel }, options = {}) => Domql.prepare(Domql.parse(text, bindings), options);
const failure = (text, bindings, options) => {
    try {
        prepare(text, bindings, options);
    } catch (error) {
        expect(error).toBeInstanceOf(DomqlError);
        expect(error.kind).toBe('validation');

        return error;
    }

    throw new Error('The query was prepared');
};

describe('RequestResolver', () => {
    describe('types', () => {
        it('types a property of the window', () => {
            expect(prepare('@window.size').type.toString()).toBe('size');
        });

        it('types a field of a structured type, nullable after a nullable receiver', () => {
            expect(prepare('@panel.size.width').type.toString()).toBe('number?');
        });

        it('types a list property and an aggregate over its items', () => {
            expect(prepare('@panel.children.count').type.toString()).toBe('number');
            expect(prepare('@panel.children.sum(size.width)').type.toString()).toBe('number');
            expect(prepare('@panel.children.max(size.width)').type.toString()).toBe('number?');
        });

        it('keeps the item type through where, first and at', () => {
            expect(prepare('@panel.children.where(is "attached").first.size').type.toString()).toBe('size?');
            expect(prepare('@panel.children.at(0).size').type.toString()).toBe('size?');
        });

        it('types a shape by its inferred field names', () => {
            expect(prepare('@panel { size, hasFocus: is "focused" }').type.toString()).toBe('{ size: size?, hasFocus: boolean }');
        });

        it('types a bound value by the type it has', () => {
            expect(prepare('@count', { count: 3 }).type.toString()).toBe('number');
            expect(prepare('@nothing', { nothing: Domql.bind(null, 'string?') }).type.toString()).toBe('string?');
        });
    });

    describe('requests', () => {
        it('prepares a path of properties and operations as a query', () => {
            expect(prepare('@panel.size').kind).toBe('query');
        });

        it('prepares an occurrence source as a subscription', () => {
            const prepared = prepare('@document.events-of "keydown" { key }');

            expect(prepared.kind).toBe('subscription');
            expect(prepared.type.toString()).toBe('occurrence<{ key: string }>');
        });

        it('shapes the occurrences of a source by the fields of its payload', () => {
            const prepared = prepare('@panel.events-of "click" { clientX, button }');

            expect(prepared.kind).toBe('subscription');
            expect(prepared.type.toString()).toBe('occurrence<{ clientX: number, button: number }>');
        });

        it('refuses an answer that is no data', () => {
            expect(failure('@panel.parent').message).toContain('no data');
            expect(failure('@panel.events-of "click"{ target }').message).toContain('no data');
        });

        it('refuses a member after an occurrence source', () => {
            expect(failure('@panel.events-of("click").count').message).toContain('occurrence source');
        });

        it('refuses an occurrence source as an argument', () => {
            expect(failure('@panel.matches(selector: @panel.events-of("click"))').message).toContain('occurrence source');
        });
    });

    describe('receivers', () => {
        it('refuses a member the receiver does not declare', () => {
            const error = failure('@panel.devicePixelRatio');

            expect(error.message).toContain('not available on element');
        });

        it('refuses an unknown member', () => {
            expect(failure('@panel.nonsense').message).toContain('no member of the vocabulary');
        });

        it('refuses a list member on an element and an element member on a list', () => {
            expect(failure('@panel.count').message).toContain('not available');
            expect(failure('@panel.children.size').message).toContain('not available on list<element>');
        });

        it('refuses a member after null', () => {
            expect(failure('null.size').message).toContain('follows null');
        });

        it('refuses an expression on a receiver that has no items', () => {
            expect(failure('@panel.sum(size.width)').message).toContain('not available');
        });
    });

    describe('arguments', () => {
        it('refuses a missing required argument', () => {
            expect(failure('@panel.matches').message).toContain("requires the argument 'selector'");
        });

        it('refuses too many arguments', () => {
            expect(failure('@panel.matches "a" "b"').message).toContain('takes 1 argument');
        });

        it('refuses an argument of the wrong type', () => {
            expect(failure('@panel.matches 3').message).toContain('expects string and finds number');
        });

        it('refuses an unknown named argument and a repeated one', () => {
            expect(failure('@panel.matches(nonsense: "a")').message).toContain("no parameter 'nonsense'");
            expect(failure('@panel.matches("a", selector: "b")').message).toContain('given twice');
        });

        it('resolves an omitted argument to its default', () => {
            const prepared = prepare('@panel.intersects');
            const [, margin] = prepared.getResolution('/query').arguments;

            expect(prepared.type.toString()).toBe('boolean?');
            expect(margin.isDefault).toBe(true);
            expect(margin.value).toBe(0);
        });

        it('accepts a null for a parameter that accepts it', () => {
            expect(prepare('@panel.intersects null').type.toString()).toBe('boolean?');
        });
    });

    describe('null', () => {
        it('makes a call answer null for a null argument of a propagating parameter', () => {
            const prepared = prepare('@panel.matches @selector', { panel, selector: Domql.bind(null, 'string?') });

            expect(prepared.type.toString()).toBe('boolean?');
        });

        it('makes a call answer null for a written null on a propagating parameter', () => {
            expect(prepare('@window.matches-media "(min-width: 1px)"').type.toString()).toBe('boolean');
            expect(prepare('@window.matches-media null').type.toString()).toBe('boolean?');
        });

        it('makes a call on a nullable receiver nullable', () => {
            expect(prepare('@panel.parent.size').type.toString()).toBe('size?');
            expect(prepare('@panel.parent.children.count').type.toString()).toBe('number?');
        });

        it('lets an aggregate expression produce null per item', () => {
            expect(prepare('@panel.children.sum(size.width)').type.toString()).toBe('number');
        });

        it('refuses an aggregate expression of another type', () => {
            expect(failure('@panel.children.sum(attribute-of "id")').message).toContain('must produce number?');
        });
    });

    describe('fixed names', () => {
        it('resolves a predicate of a receiver', () => {
            const prepared = prepare('@panel.is "disabled"');

            expect(prepared.type.toString()).toBe('boolean');
            expect(prepared.getResolution('/query').selected.name).toBe('disabled');
        });

        it('takes the name from a bound string', () => {
            expect(prepare('@panel.is @name', { panel, name: 'focused' }).type.toString()).toBe('boolean');
        });

        it('refuses a predicate the receiver has not', () => {
            expect(failure('@panel.is "visible"').message).toContain('no predicate of element');
            expect(failure('@panel.is "nonsense"').message).toContain("'is' reads");
        });

        it('keeps is and has apart', () => {
            expect(failure('@panel.has "disabled"').message).toContain('no predicate');
            expect(prepare('@panel.has "children"').type.toString()).toBe('boolean');
        });

        it('refuses a name that is null, unbound text or no string', () => {
            expect(failure('@panel.is @name', { panel, name: Domql.bind(null, 'string?') }).message).toContain('never null');
            expect(failure('@panel.is @name', { panel, name: 3 }).message).toContain('expects string and finds number');
            expect(failure('@panel.is(@panel.attribute-of "kind")').message).toContain('string literal or a parameter bound to a string');
            expect(failure('@panel.is null').message).toContain('never null');
        });

        it('resolves the path a get names to the type at its end', () => {
            expect(prepare('@panel.get "size.width"').type.toString()).toBe('number?');
            expect(prepare('@panel.get "children.count"').type.toString()).toBe('number');
        });

        it('refuses a get of a path that names nothing', () => {
            expect(failure('@panel.get "size.depth"').message).toContain("'depth' names no property");
            expect(failure('@panel.get "matches"').message).toContain('reads without arguments');
        });

        it('resolves an event type and a feature', () => {
            expect(prepare('@document.events-of "keydown" { key }').type.toString()).toBe('occurrence<{ key: string }>');
            expect(prepare('@window.supports "share"').type.toString()).toBe('boolean');
        });

        it('refuses an event type or a feature the vocabulary does not declare', () => {
            expect(failure('@panel.events-of "nonsense"').message).toContain('no event type');
            expect(failure('@window.supports "nonsense"').message).toContain('no feature');
        });
    });

    describe('modules', () => {
        it('resolves against the types, predicates and events a registered module contributes', () => {
            const module = new DomqlModule('charts', {
                types: [{ name: 'chartEvent', fields: { value: 'number' } }],
                events: [{ name: 'chart-selected', payload: 'chartEvent' }],
                predicates: [{ verb: 'is', name: 'plotted', on: 'element', changes: 'observable', reads: 'fresh' }],
            });

            Domql.registerModule(module);

            const element = document.createElement('div');
            const events = Domql.prepare(Domql.parse('@panel.events-of "chart-selected" { value }', { panel: element }));
            const predicate = Domql.prepare(Domql.parse('@panel.is "plotted"', { panel: element }));

            expect(events.type.toString()).toBe('occurrence<{ value: number }>');
            expect(predicate.type.toString()).toBe('boolean');
        });
    });

    describe('observation', () => {
        it('lets a query follow anything', () => {
            expect(() => prepare('@panel.matches ":hover"')).not.toThrow();
        });

        it('refuses a watch of a partly observable member unless it accepts partial observation', () => {
            const error = failure('@panel.matches ":hover"', { panel }, { watch: true });

            expect(error.message).toContain('misses pointer state');
            expect(() => prepare('@panel.matches ":hover"', { panel }, { watch: true, acceptPartialObservation: true })).not.toThrow();
        });

        it('lets a watch follow what is observable', () => {
            expect(() => prepare('@panel.size', { panel }, { watch: true })).not.toThrow();
        });

        it('lists the declarations a request uses', () => {
            const names = prepare('@panel.children.count').usedMembers.map(use => use.declaration.name);

            expect(names).toEqual(['children', 'count']);
        });
    });

    describe('errors', () => {
        it('locates an error in the query text', () => {
            const error = failure('@panel.matches 3');

            expect(error.location.line).toBe(1);
            expect(error.location.column).toBe(16);
            expect(error.location.pointer).toBe('/query/arguments/0/value');
        });

        it('points into a definition that has no text', () => {
            const definition = {
                version: 1,
                query: { kind: 'member', target: { kind: 'parameter', name: 'panel' }, name: 'nonsense', arguments: [] },
            };

            try {
                Domql.prepare(Domql.create(definition, { panel }));
            } catch (error) {
                expect(error.location.pointer).toBe('/query');

                return;
            }

            throw new Error('The query was prepared');
        });

        it('prepares without a browser-bound evaluation', () => {
            expect(prepare('@panel.size').definition).toBe(Domql.parse('@panel.size', { panel }).definition);
        });
    });
});
