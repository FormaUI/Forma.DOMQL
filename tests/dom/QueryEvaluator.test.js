import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { QueryEvaluator } from '#domql/dom/QueryEvaluator.mjs';
import { Domql } from '#domql/domql.js';
import { DomqlError } from '#domql/language/DomqlError.mjs';
import { DomqlModule } from '#domql/language/vocabulary/DomqlModule.mjs';
import { LanguageResolver } from '#domql/language/LanguageResolver.mjs';
import { ModuleRegistry } from '#domql/language/vocabulary/ModuleRegistry.mjs';
import { Vocabulary } from '#domql/language/vocabulary/Vocabulary.mjs';

/** Gives the element a border box, since the test environment lays nothing out. */
const lay = (element, { left = 0, top = 0, width = 0, height = 0 }) => {
    element.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
    element.getClientRects = () => [element.getBoundingClientRect()];
};

/** Takes the element's layout box away, as `display: none` does. */
const unlay = element => {
    element.getClientRects = () => [];
};

const read = (text, bindings = {}) => Domql.read(Domql.parse(text, bindings));

/** A module of one number property named for itself, answered by the function. */
const propertyModule = (name, implementation) => new DomqlModule(name, {
    members: [{ name, builder: name, function: name, kind: 'property', on: 'element', parameters: [], result: 'number', changes: 'constant', reads: 'fresh' }],
}, implementation === undefined ? null : { [name]: implementation });

/** Reads a query against a registry of its own holding the built-in vocabulary and the module. */
const readWith = (module, text, bindings) => {
    const registry = new ModuleRegistry([Vocabulary.module, module]);
    const query = Domql.parse(text, bindings);
    const resolved = new LanguageResolver(registry, query.bindings, null, {}).resolveDefinition(query.definition);

    return new QueryEvaluator(registry, resolved, query.bindings, { window, document }, null).read();
};

const failureWith = (module, text, bindings) => {
    try {
        readWith(module, text, bindings);
    } catch (error) {
        expect(error).toBeInstanceOf(DomqlError);
        expect(error.kind).toBe('evaluation');

        return error;
    }

    throw new Error('The query was read');
};

const failure = (text, bindings = {}) => {
    try {
        read(text, bindings);
    } catch (error) {
        expect(error).toBeInstanceOf(DomqlError);
        expect(error.kind).toBe('evaluation');

        return error;
    }

    throw new Error('The query was read');
};

describe('QueryEvaluator', () => {
    let panel;
    let items;

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="panel">
                <div data-key="a1"></div>
                <div data-key="a2" aria-selected="true"></div>
                <div data-key="a3"></div>
            </div>`;
        panel = document.getElementById('panel');
        items = [...panel.children];
        lay(panel, { width: 640, height: 480 });
        items.forEach((item, index) => lay(item, { top: index * 50, width: 640, height: [48, 64, 48][index] }));
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    describe('structure', () => {
        it('reads children, counts and selects', () => {
            expect(read('@panel.children.count', { panel })).toBe(3);
            expect(read('@panel.all("[data-key]").count', { panel })).toBe(3);
            expect(read('@panel.first("[aria-selected=true]").attribute-of("data-key")', { panel })).toBe('a2');
            expect(read('@item.closest("#panel").attribute-of "id"', { item: items[0] })).toBe('panel');
        });

        it('answers an empty list where nothing matches and null where an element is expected', () => {
            expect(read('@panel.all(".none").count', { panel })).toBe(0);
            expect(read('@panel.first(".none").attribute-of "id"', { panel })).toBeNull();
            expect(read('@panel.closest(".none") { id: attribute-of "id" }', { panel })).toBeNull();
        });

        it('reads list items by position', () => {
            expect(read('@panel.children.first { key: attribute-of "data-key" }', { panel })).toEqual({ key: 'a1' });
            expect(read('@panel.children.last { key: attribute-of "data-key" }', { panel })).toEqual({ key: 'a3' });
            expect(read('@panel.children.at(1) { key: attribute-of "data-key" }', { panel })).toEqual({ key: 'a2' });
            expect(read('@panel.children.at(3) { key: attribute-of "data-key" }', { panel })).toBeNull();
            expect(read('@panel.children.at(-1) { key: attribute-of "data-key" }', { panel })).toBeNull();
        });

        it('reads the parent', () => {
            expect(read('@item.parent { id: attribute-of "id" }', { item: items[0] })).toEqual({ id: 'panel' });
        });
    });

    describe('null', () => {
        it('answers null from the first null on', () => {
            const detached = document.createElement('div');

            expect(read('@detached.parent.size', { detached })).toBeNull();
            expect(read('@detached.parent.children.count', { detached })).toBeNull();
            expect(read('@detached { parent: parent.size, tag: attribute-of "id" }', { detached })).toEqual({ parent: null, tag: null });
        });

        it('answers null for an attribute the element does not have', () => {
            expect(read('@panel.attribute-of "nothing"', { panel })).toBeNull();
        });

        it('answers null for a null argument of a propagating parameter without calling the member', () => {
            expect(read('@panel.attribute-of @name', { panel, name: Domql.bind(null, 'string?') })).toBeNull();
        });
    });

    describe('shapes', () => {
        it('names fields by inference and keeps their order', () => {
            const answer = read('@panel { count: children.count, id: attribute-of "id", is "attached", has "children" }', { panel });

            expect(answer).toEqual({ count: 3, id: 'panel', attached: true, children: true });
            expect(Object.keys(answer)).toEqual(['count', 'id', 'attached', 'children']);
        });

        it('applies a shape to each item of a list, in order', () => {
            expect(read('@panel.children { key: attribute-of "data-key", selected: matches "[aria-selected=true]" }', { panel })).toEqual([
                { key: 'a1', selected: false },
                { key: 'a2', selected: true },
                { key: 'a3', selected: false },
            ]);
        });

        it('shapes a top-level list of facts', () => {
            expect(read('{ items: @panel.children.count, kind: "list", none: null }', { panel })).toEqual({ items: 3, kind: 'list', none: null });
        });
    });

    describe('lists', () => {
        it('aggregates the numbers an expression produces', () => {
            expect(read('@panel.children.max(rect.height)', { panel })).toBe(64);
            expect(read('@panel.children.min(rect.height)', { panel })).toBe(48);
            expect(read('@panel.children.sum(rect.height)', { panel })).toBe(160);
        });

        it('answers the aggregates of an empty list', () => {
            expect(read('@panel.all(".none").max(rect.height)', { panel })).toBeNull();
            expect(read('@panel.all(".none").min(rect.height)', { panel })).toBeNull();
            expect(read('@panel.all(".none").sum(rect.height)', { panel })).toBe(0);
        });

        it('skips the items an expression produces null for', () => {
            const detached = [document.createElement('div'), document.createElement('div')];

            expect(read('@els.max(rect.height)', { els: detached })).toBeNull();
            expect(read('@els.sum(rect.height)', { els: detached })).toBe(0);
            expect(read('@els.max(rect.height)', { els: [items[0], ...detached] })).toBe(48);
        });

        it('keeps the items a Boolean expression holds for', () => {
            expect(read('@panel.children.where(matches "[aria-selected=true]").count', { panel })).toBe(1);
            expect(read('@panel.children.where(has "children").count', { panel })).toBe(0);
            expect(read('@els.where(overlaps @panel).count', { els: [items[0], document.createElement('div')], panel })).toBe(1);
        });
    });

    describe('reading by name', () => {
        it('reads what a name resolves to, as direct access does', () => {
            expect(read('@panel.get "children.count"', { panel })).toBe(3);
            expect(read('@panel.get "size.width"', { panel })).toBe(640);
            expect(read('@panel { get "size", get "clientSize" }', { panel }).size).toEqual({ width: 640, height: 480 });
        });

        it('takes the name from a bound string', () => {
            expect(read('@panel.get @name', { panel, name: 'children.count' })).toBe(3);
        });

        it('answers null where a step of the path is null', () => {
            const detached = document.createElement('div');

            expect(read('@detached.get "size.width"', { detached })).toBeNull();
        });
    });

    describe('predicates', () => {
        it('answers is and has', () => {
            document.body.insertAdjacentHTML('beforeend', '<button id="b" disabled></button><input id="i" readonly><textarea id="t"></textarea><div id="e" contenteditable="true"><span id="s"></span></div><div inert><div id="n" contenteditable="true"></div></div>');
            const element = id => document.getElementById(id);

            expect(read('@b.is "disabled"', { b: element('b') })).toBe(true);
            expect(read('@panel.is "disabled"', { panel })).toBe(false);
            expect(read('@i.is "readOnly"', { i: element('i') })).toBe(true);
            expect(read('@i.is "textEditable"', { i: element('i') })).toBe(false);
            expect(read('@t.is "textEditable"', { t: element('t') })).toBe(true);
            expect(read('@s.is "textEditable"', { s: element('s') })).toBe(true);
            expect(read('@n.is "textEditable"', { n: element('n') })).toBe(false);
            expect(read('@panel.is "textEditable"', { panel })).toBe(false);
            expect(read('@panel.has "children"', { panel })).toBe(true);
            expect(read('@item.has "children"', { item: items[0] })).toBe(false);
        });

        it('answers whether an element is attached', () => {
            expect(read('@panel.is "attached"', { panel })).toBe(true);
            expect(read('@detached.is "attached"', { detached: document.createElement('div') })).toBe(false);
        });

        it('answers whether an element is focused', () => {
            const button = document.createElement('button');
            document.body.append(button);

            expect(read('@button.is "focused"', { button })).toBe(false);

            button.focus();

            expect(read('@button.is "focused"', { button })).toBe(true);
        });

        it('answers the document predicates', () => {
            expect(read('@document.is "visible"')).toBeTypeOf('boolean');
            expect(read('@document.has "focus"')).toBeTypeOf('boolean');
        });

        it('answers a selection of a text control', () => {
            const input = document.createElement('input');
            input.value = 'hello';
            document.body.append(input);
            input.setSelectionRange(1, 3);

            expect(read('@input.selection { start, end }', { input })).toEqual({ start: 1, end: 3 });
            expect(read('@input.has "selection"', { input })).toBe(true);

            input.setSelectionRange(2, 2);

            expect(read('@input.has "selection"', { input })).toBe(false);
            expect(read('@panel.selection { start }', { panel })).toBeNull();
        });
    });

    describe('geometry', () => {
        it('reads a rectangle from the layout viewport and relative to another element', () => {
            expect(read('@item.rect', { item: items[1] })).toEqual({ left: 0, top: 50, right: 640, bottom: 114, width: 640, height: 64 });
            expect(read('@item.rect(relativeTo: @panel)', { item: items[1], panel })).toEqual({ left: 0, top: 50, right: 640, bottom: 114, width: 640, height: 64 });
            expect(read('@item.rect.height', { item: items[1] })).toBe(64);
        });

        it('answers null for an element without layout', () => {
            const detached = document.createElement('div');

            expect(read('@detached.rect', { detached })).toBeNull();
            expect(read('@item.rect(relativeTo: @detached)', { item: items[0], detached })).toBeNull();
            expect(read('@item.rect(relativeTo: @none)', { item: items[0], none: Domql.bind(null, 'element?') })).toBeNull();
        });

        it('answers null for an attached element without a layout box and the actual zero of one with a box of no size', () => {
            const hidden = document.createElement('div');
            document.body.append(hidden);
            lay(hidden, {});

            expect(read('@hidden.size', { hidden })).toEqual({ width: 0, height: 0 });
            expect(read('@hidden.rect.width', { hidden })).toBe(0);

            unlay(hidden);

            expect(read('@hidden.size', { hidden })).toBeNull();
            expect(read('@hidden.rect', { hidden })).toBeNull();
            expect(read('@hidden.clientSize', { hidden })).toBeNull();
            expect(read('@hidden.grid.columns', { hidden })).toBeNull();
            expect(read('@hidden.is "attached"', { hidden })).toBe(true);
            expect(read('@item.rect(relativeTo: @hidden)', { item: items[0], hidden })).toBeNull();
            expect(read('@hidden.overlaps @item', { hidden, item: items[0] })).toBeNull();
        });

        it('compares two boxes', () => {
            expect(read('@a.overlaps @b', { a: items[0], b: items[1] })).toBe(false);
            expect(read('@a.overlaps(@b, margin: 10)', { a: items[0], b: items[1] })).toBe(true);
            expect(read('@a.overlaps @b', { a: items[0], b: items[0] })).toBe(true);
        });
    });

    describe('the window', () => {
        it('reads the window and its media queries', () => {
            expect(read('@window.size.width')).toBeTypeOf('number');
            expect(read('@window.devicePixelRatio')).toBeTypeOf('number');
            expect(read('@window.matches-media "(min-width: 0px)"')).toBe(true);
            expect(read('@window { share: supports "share" }').share).toBeTypeOf('boolean');
        });

        it('reads the window it is given', () => {
            const query = Domql.parse('@window.devicePixelRatio');

            expect(Domql.read(query, { window: { document, devicePixelRatio: 3 } })).toBe(3);
        });
    });

    describe('computed style', () => {
        it('reads a custom property and answers null for one that is not set', () => {
            panel.style.setProperty('--tier', 'medium');

            expect(read('@panel.computedstyle-of "--tier"', { panel })).toBe('medium');
            expect(read('@panel.computedstyle-of "--none"', { panel })).toBeNull();
        });
    });

    describe('answers', () => {
        it('are the same for a parsed query and one created from its definition', () => {
            const parsed = Domql.parse('@panel { count: children.count, keys: children { key: attribute-of "data-key" } }', { panel });
            const created = Domql.create(parsed.definition, { panel });

            expect(Domql.read(created)).toEqual(Domql.read(parsed));
        });

        it('are immutable data that shares nothing with the bindings', () => {
            const numbers = [1, 2, 3];
            const answer = read('@numbers', { numbers });

            expect(answer).toEqual(numbers);
            expect(answer).not.toBe(numbers);
            expect(Object.isFrozen(answer)).toBe(true);
            expect(Object.isFrozen(read('@panel { size }', { panel }))).toBe(true);
        });

        it('read a field of a bound object', () => {
            expect(read('@box.width', { box: { width: 5, height: 6 } })).toBe(5);
            expect(read('@box { width, other: height }', { box: { width: 5, height: 6 } })).toEqual({ width: 5, other: 6 });
        });
    });

    describe('errors', () => {
        it('fail where a member fails, naming it and where', () => {
            const error = failure('@panel.matches "["', { panel });

            expect(error.message).toContain("The member 'matches' failed");
            expect(error.location.line).toBe(1);
            expect(error.cause).toBeInstanceOf(Error);
        });

        it('refuse a member maintained by an observation', () => {
            expect(failure('@item.intersects', { item: items[0] }).message).toContain("The member 'intersects' failed");
        });

        it('refuse a request that is not a query', () => {
            expect(failure('@panel.events-of "click" { button }', { panel }).message).toContain('subscription request is not read');
        });

        it('refuse a request that is not valid before reading anything', () => {
            expect(() => read('@panel.nonsense', { panel })).toThrow(expect.objectContaining({ kind: 'validation' }));
        });

        it('report a module that answers a type other than the one it declares', () => {
            const error = failureWith(propertyModule('broken', () => 'seven'), '@panel.broken', { panel });

            expect(error.message).toContain('answered "seven", and it declares number');
        });

        it('name an element a module answers where a number is declared', () => {
            expect(failureWith(propertyModule('leaking', element => element), '@panel.leaking', { panel }).message).toContain('answered an element, and it declares number');
        });

        it('report a module that declares and does not implement', () => {
            expect(failureWith(propertyModule('declared'), '@panel.declared', { panel }).message).toContain("The module 'declared' supplies no function for 'declared'");
        });
    });
});
