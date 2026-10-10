import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { BrowserModule } from '#domql/dom/BrowserModule.mjs';
import { Observations } from '#domql/dom/Observations.mjs';
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
    members: [{ name, function: name, kind: 'property', on: 'element', parameters: [], result: 'number', changes: 'constant', reads: 'fresh' }],
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
            expect(read('@panel.first("[aria-selected=true]").attributeOf("data-key")', { panel })).toBe('a2');
            expect(read('@item.closest("#panel").attributeOf("id")', { item: items[0] })).toBe('panel');
        });

        it('answers an empty list where nothing matches and null where an element is expected', () => {
            expect(read('@panel.all(".none").count', { panel })).toBe(0);
            expect(read('@panel.first(".none").attributeOf("id")', { panel })).toBeNull();
            expect(read('@panel.closest(".none") { id: attributeOf "id" }', { panel })).toBeNull();
        });

        it('reads list items by position', () => {
            expect(read('@panel.children.first { key: attributeOf "data-key" }', { panel })).toEqual({ key: 'a1' });
            expect(read('@panel.children.last { key: attributeOf "data-key" }', { panel })).toEqual({ key: 'a3' });
            expect(read('@panel.children.at(1) { key: attributeOf "data-key" }', { panel })).toEqual({ key: 'a2' });
            expect(read('@panel.children.at(3) { key: attributeOf "data-key" }', { panel })).toBeNull();
            expect(read('@panel.children.at(-1) { key: attributeOf "data-key" }', { panel })).toBeNull();
        });

        it('reads the parent', () => {
            expect(read('@item.parent { id: attributeOf "id" }', { item: items[0] })).toEqual({ id: 'panel' });
        });
    });

    describe('null', () => {
        it('answers null from the first null on', () => {
            const detached = document.createElement('div');

            expect(read('@detached.parent.size', { detached })).toBeNull();
            expect(read('@detached.parent.children.count', { detached })).toBeNull();
            expect(read('@detached { parent: parent.size, tag: attributeOf "id" }', { detached })).toEqual({ parent: null, tag: null });
        });

        it('answers null for an attribute the element does not have', () => {
            expect(read('@panel.attributeOf("nothing")', { panel })).toBeNull();
        });

        it('answers null for a null argument of a propagating parameter without calling the member', () => {
            expect(read('@panel.attributeOf(@name)', { panel, name: Domql.bind(null, 'string?') })).toBeNull();
        });
    });

    describe('shapes', () => {
        it('names fields by inference and keeps their order', () => {
            const answer = read('@panel { count: children.count, id: attributeOf "id", is "attached", has "children" }', { panel });

            expect(answer).toEqual({ count: 3, id: 'panel', attached: true, children: true });
            expect(Object.keys(answer)).toEqual(['count', 'id', 'attached', 'children']);
        });

        it('applies a shape to each item of a list, in order', () => {
            expect(read('@panel.children { key: attributeOf "data-key", selected: matches "[aria-selected=true]" }', { panel })).toEqual([
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
            expect(read('@panel.get("children.count")', { panel })).toBe(3);
            expect(read('@panel.get("size.width")', { panel })).toBe(640);
            expect(read('@panel { get "size", get "clientSize" }', { panel }).size).toEqual({ width: 640, height: 480 });
        });

        it('takes the name from a bound string', () => {
            expect(read('@panel.get(@name)', { panel, name: 'children.count' })).toBe(3);
        });

        it('answers null where a step of the path is null', () => {
            const detached = document.createElement('div');

            expect(read('@detached.get("size.width")', { detached })).toBeNull();
        });
    });

    describe('predicates', () => {
        it('answers is and has', () => {
            document.body.insertAdjacentHTML('beforeend', '<button id="b" disabled></button><input id="i" readonly><textarea id="t"></textarea><div id="e" contenteditable="true"><span id="s"></span></div><div inert><div id="n" contenteditable="true"></div></div>');
            const element = id => document.getElementById(id);

            expect(read('@b is "disabled"', { b: element('b') })).toBe(true);
            expect(read('@panel is "disabled"', { panel })).toBe(false);
            expect(read('@i is "readOnly"', { i: element('i') })).toBe(true);
            expect(read('@i is "textEditable"', { i: element('i') })).toBe(false);
            expect(read('@t is "textEditable"', { t: element('t') })).toBe(true);
            expect(read('@s is "textEditable"', { s: element('s') })).toBe(true);
            expect(read('@n is "textEditable"', { n: element('n') })).toBe(false);
            expect(read('@panel is "textEditable"', { panel })).toBe(false);
            expect(read('@panel has "children"', { panel })).toBe(true);
            expect(read('@item has "children"', { item: items[0] })).toBe(false);
        });

        it('answers whether an element is attached', () => {
            expect(read('@panel is "attached"', { panel })).toBe(true);
            expect(read('@detached is "attached"', { detached: document.createElement('div') })).toBe(false);
        });

        it('answers whether an element is focused', () => {
            const button = document.createElement('button');
            document.body.append(button);

            expect(read('@button is "focused"', { button })).toBe(false);

            button.focus();

            expect(read('@button is "focused"', { button })).toBe(true);
        });

        it('answers the document predicates', () => {
            expect(read('@document is "visible"')).toBeTypeOf('boolean');
            expect(read('@document has "focus"')).toBeTypeOf('boolean');
        });

        it('answers a selection of a text control', () => {
            const input = document.createElement('input');
            input.value = 'hello';
            document.body.append(input);
            input.setSelectionRange(1, 3);

            expect(read('@input.selection { start, end }', { input })).toEqual({ start: 1, end: 3 });
            expect(read('@input has "selection"', { input })).toBe(true);

            input.setSelectionRange(2, 2);

            expect(read('@input has "selection"', { input })).toBe(false);
            expect(read('@panel.selection { start }', { panel })).toBeNull();
        });
    });

    describe('predicate tests', () => {
        /** A module whose predicates answer what the test sets and count how often they are read. */
        const probes = () => {
            const record = { yes: 0, no: 0 };
            const module = new DomqlModule('probe', {
                predicates: [
                    { verb: 'is', name: 'yes', function: 'isYes', on: 'element', changes: 'constant', reads: 'fresh' },
                    { verb: 'is', name: 'no', function: 'isNo', on: 'element', changes: 'constant', reads: 'fresh' },
                ],
            }, {
                isYes: () => { record.yes++; return true; },
                isNo: () => { record.no++; return false; },
            });

            return { module, record };
        };

        it.each([
            ['"yes" and "yes"', true],
            ['"yes" and "no"', false],
            ['"no" or "yes"', true],
            ['"no" or "no"', false],
            ['"no" or "yes" and "yes"', true],
            ['("no" or "yes") and "no"', false],
        ])('answer is %s as and, or and grouping define', (names, expected) => {
            expect(readWith(probes().module, `@panel is ${names}`, { panel })).toBe(expected);
        });

        it('read no predicate the result does not need', () => {
            const { module, record } = probes();

            expect(readWith(module, '@panel is "no" and "yes"', { panel })).toBe(false);
            expect(record).toEqual({ yes: 0, no: 1 });
            expect(readWith(module, '@panel is "yes" or "no"', { panel })).toBe(true);
            expect(record).toEqual({ yes: 1, no: 1 });
        });

        it('evaluate the subject once, whatever number of predicates it reaches', () => {
            const { module, record } = probes();
            let reads = 0;
            const counting = new DomqlModule('counted', {
                members: [{ name: 'counted', function: 'counted', kind: 'property', on: 'element', parameters: [], result: 'element', changes: 'constant', reads: 'fresh' }],
            }, { counted: element => { reads++; return element; } });
            const registry = new ModuleRegistry([Vocabulary.module, module, counting]);
            const query = Domql.parse('@panel.counted is "yes" and "yes" and "yes"', { panel });
            const resolved = new LanguageResolver(registry, query.bindings, null, {}).resolveDefinition(query.definition);

            expect(new QueryEvaluator(registry, resolved, query.bindings, { window, document }, null).read()).toBe(true);
            expect(reads).toBe(1);
            expect(record.yes).toBe(3);
        });

        it('answer null for a subject that is null', () => {
            expect(read('@panel.first(".none") is "attached" or "focused"', { panel })).toBeNull();
        });

        it('test the current value inside a shape and an expression', () => {
            expect(read('@panel { attached: is "attached", empty: has "children" }', { panel })).toEqual({ attached: true, empty: true });
            expect(read('@panel.children.where(is "attached" and "focused").count', { panel })).toBe(0);
        });

        it('take the names of a test from its bindings', () => {
            expect(read('@panel is @state or @other', { panel, state: 'focused', other: 'attached' })).toBe(true);
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
            expect(read('@hidden is "attached"', { hidden })).toBe(true);
            expect(read('@item.rect(relativeTo: @hidden)', { item: items[0], hidden })).toBeNull();
            expect(read('@hidden.overlaps(@item)', { hidden, item: items[0] })).toBeNull();
        });

        it('compares two boxes', () => {
            expect(read('@a.overlaps(@b)', { a: items[0], b: items[1] })).toBe(false);
            expect(read('@a.overlaps(@b, margin: 10)', { a: items[0], b: items[1] })).toBe(true);
            expect(read('@a.overlaps(@b)', { a: items[0], b: items[0] })).toBe(true);
        });
    });

    describe('the window', () => {
        it('reads the window and its media queries', () => {
            expect(read('@window.size.width')).toBeTypeOf('number');
            expect(read('@window.devicePixelRatio')).toBeTypeOf('number');
            expect(read('@window.matchesMedia("(min-width: 0px)")')).toBe(true);
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

            expect(read('@panel.computedStyleOf("--tier")', { panel })).toBe('medium');
            expect(read('@panel.computedStyleOf("--none")', { panel })).toBeNull();
        });
    });

    describe('answers', () => {
        it('are the same for a parsed query and one created from its definition', () => {
            const parsed = Domql.parse('@panel { count: children.count, keys: children { key: attributeOf "data-key" } }', { panel });
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
            const error = failure('@panel.matches("[")', { panel });

            expect(error.message).toContain("The member 'matches' failed");
            expect(error.location.line).toBe(1);
            expect(error.cause).toBeInstanceOf(Error);
        });

        it('fail where a member throws what is no error, keeping it as the cause', () => {
            const error = failureWith(propertyModule('nothing', () => {
                throw null;
            }), '@panel.nothing', { panel });

            expect(error.message).toContain("The member 'nothing' failed: null");
            expect(error.cause).toBeNull();
        });

        it('refuse a member maintained by an observation', () => {
            expect(failure('@item.intersects', { item: items[0] }).message).toContain("The member 'intersects' is maintained by an observation");
        });

        it('refuse a request that is not valid before reading anything', () => {
            expect(() => read('@panel.nonsense', { panel })).toThrow(expect.objectContaining({ kind: 'validation' }));
        });

        it('report a module that answers a type other than the one it declares', () => {
            const error = failureWith(propertyModule('broken', () => 'seven'), '@panel.broken', { panel });

            expect(error.message).toContain('answered "seven", and it declares number');
        });

        it('report a module that answers a list with a hole, which holds no value there', () => {
            const gappy = new DomqlModule('gappy', {
                members: [{ name: 'gappy', function: 'gappy', kind: 'property', on: 'element', parameters: [], result: 'list<number?>', changes: 'constant', reads: 'fresh' }],
            }, { gappy: () => [1, , 2] });

            expect(failureWith(gappy, '@panel.gappy', { panel }).message).toContain('answered a list with a hole at index 1, and it declares list<number?>');
        });

        it('name an element a module answers where a number is declared', () => {
            expect(failureWith(propertyModule('leaking', element => element), '@panel.leaking', { panel }).message).toContain('answered an element, and it declares number');
        });

        it('report a module that declares and does not implement', () => {
            expect(failureWith(propertyModule('declared'), '@panel.declared', { panel }).message).toContain("The module 'declared' supplies no function for 'declared'");
        });
    });
});

describe('QueryEvaluator evaluation', () => {
    let panel;
    let rows;
    let observations;
    let evaluations;
    let changes;

    beforeEach(() => {
        document.body.innerHTML = '<div id="panel"><i></i><i></i><i></i></div>';
        panel = document.getElementById('panel');
        rows = [...panel.children];
        evaluations = [];
        changes = 0;
    });

    afterEach(() => {
        evaluations.forEach(evaluation => evaluation.dispose());
        document.body.innerHTML = '';
    });

    /** Evaluates the query against the registry, holding its observations in `observations`. */
    const evaluate = (text, bindings = {}, modules = [], holdsAll = false) => {
        const registry = new ModuleRegistry([BrowserModule.create(), ...modules]);
        const query = Domql.parse(text, bindings);
        const resolved = new LanguageResolver(registry, query.bindings, null, { watch: true, acceptPartialObservation: true }).resolveDefinition(query.definition);
        const evaluator = new QueryEvaluator(registry, resolved, query.bindings, { window, document }, null);

        observations = new Observations(registry, { window, document });

        const evaluation = evaluator.evaluate({ observations, onChange: () => changes++, holdsAll });

        evaluations.push(evaluation);

        return evaluation;
    };

    const membersOf = evaluation => evaluation.dependencies.map(dependency => dependency.member);

    describe('dependencies', () => {
        it('are each member applied to its receiver and arguments, with the observations that cover it', () => {
            const evaluation = evaluate('@panel.attributeOf("id")', { panel });

            expect(evaluation.value).toBe('panel');
            expect(evaluation.dependencies).toEqual([{
                member: 'attributeOf',
                pointer: '/query',
                observations: [{ type: 'mutation', target: panel, arguments: { attributes: ['id'] } }],
            }]);
        });

        it('follow the document: the members read for each item the selector matched', () => {
            const evaluation = evaluate('@panel.all("i").max(rect.height)', { panel });
            const measured = evaluation.dependencies.filter(dependency => dependency.member === 'rect');

            expect(membersOf(evaluation).slice(0, 2)).toEqual(['all', 'max']);
            expect(measured.map(dependency => dependency.observations[0].target)).toEqual(rows);
            expect(measured.every(dependency => dependency.observations[0].type === 'resize')).toBe(true);
        });

        it('stand where each member is written, inside the items of a list and the operands of a test', () => {
            const evaluation = evaluate('@panel.all("i") { h: rect.height, on: is "attached" or "focused" }', { panel });

            expect(evaluation.dependencies.map(dependency => [dependency.member, dependency.pointer])).toEqual([
                ['all', '/query/target'],
                ...rows.flatMap(() => [['rect', '/query/fields/0/value/target'], ['attached', '/query/fields/1/value/test/operands/0']]),
            ]);
        });

        it('include those of an argument that is a value of its own', () => {
            const evaluation = evaluate('@row.overlaps(@panel.parent)', { row: rows[0], panel });
            const overlaps = evaluation.dependencies.find(dependency => dependency.member === 'overlaps');

            expect(membersOf(evaluation)).toContain('parent');
            expect(overlaps.observations.some(observation => observation.type === 'resize' && observation.target === panel.parentElement)).toBe(true);
        });

        it('include what a path read before it met null, and nothing after', () => {
            const evaluation = evaluate('@panel.closest(".none").attributeOf("id")', { panel });

            expect(evaluation.value).toBeNull();
            expect(membersOf(evaluation)).toEqual(['closest']);
            expect(evaluation.dependencies[0].observations.length).toBeGreaterThan(0);
        });

        it('include the attachment of an element that answered null because it is detached', () => {
            const detached = document.createElement('div');
            const evaluation = evaluate('@element.rect', { element: detached });
            const attachments = evaluation.dependencies.flatMap(dependency => dependency.observations).filter(observation => observation.type === 'attachment');

            expect(evaluation.value).toBeNull();
            expect(attachments).toEqual([{ type: 'attachment', target: detached, arguments: {} }]);
        });

        it('leave the attachment out for an element that is attached', () => {
            const evaluation = evaluate('@element.attributeOf("id")', { element: panel });

            expect(evaluation.dependencies.flatMap(dependency => dependency.observations).some(observation => observation.type === 'attachment')).toBe(false);
        });

        it('include the predicates a test reached, and none it did not need', () => {
            const reached = evaluate('@panel is "attached" or "focused"', { panel });
            const both = evaluate('@panel is "focused" or "attached"', { panel });

            expect(membersOf(reached)).toEqual(['attached']);
            expect(membersOf(both)).toEqual(['focused', 'attached']);
        });

        it('are kept with the failure of an evaluation that recorded them before it failed', () => {
            const evaluation = evaluate('{ id: @panel.attributeOf("id"), boom: @panel.boom }', { panel }, [propertyModule('boom', () => { throw new Error('no'); })]);

            expect(evaluation.error).toBeInstanceOf(DomqlError);
            expect(evaluation.error.message).toContain("The member 'boom' failed");
            expect(evaluation.value).toBeUndefined();
            expect(membersOf(evaluation)).toEqual(['attributeOf', 'boom']);
        });
    });

    /** A member kept by an observation that never samples, so an evaluation that reads it stays pending. */
    const waitingModule = () => new DomqlModule('level', {
        observationTypes: [{ name: 'level', contract: 'maintained', function: 'observeLevel' }],
        members: [{
            name: 'level', function: 'level', kind: 'property', on: 'element', parameters: [], result: 'number?',
            changes: 'observable', reads: 'maintained', observations: [{ type: 'level', of: 'receiver' }],
        }],
    }, {
        observeLevel: () => ({ stop: () => {}, sample: () => ({ pending: true, value: null }) }),
        level: (_receiver, _args, _environment, [sample]) => sample,
    });

    describe('observations', () => {
        it('are not held for an answer that is complete, which needs nothing more observed', () => {
            const evaluation = evaluate('@panel.attributeOf("id")', { panel });

            expect(evaluation.isPending).toBe(false);
            expect(evaluation.dependencies.length).toBe(1);
            expect(observations.running).toBe(0);
        });

        it('are all held for a pending answer, which waits on any of them changing', () => {
            const evaluation = evaluate('{ id: @panel.attributeOf("id"), level: @panel.level }', { panel }, [waitingModule()]);

            expect(evaluation.isPending).toBe(true);
            expect(evaluation.value).toEqual({ id: 'panel', level: null });
            expect(observations.running).toBe(2);
        });

        it('are all held where the caller keeps the answer current', () => {
            evaluate('@panel.attributeOf("id")', { panel }, [], true);

            expect(observations.running).toBe(1);
        });

        it('are held while the evaluation is, and let go when it is disposed', () => {
            const evaluation = evaluate('@panel.attributeOf("id")', { panel }, [], true);

            expect(observations.running).toBe(1);

            evaluation.dispose();

            expect(observations.running).toBe(0);
            expect(evaluation.isDisposed).toBe(true);
        });

        it('call the evaluation back when something it depends on changes', async () => {
            evaluate('@panel.attributeOf("id")', { panel }, [], true);
            panel.setAttribute('id', 'renamed');

            await new Promise(resolve => setTimeout(resolve));

            expect(changes).toBe(1);
        });
    });
});

describe('QueryEvaluator projection', () => {
    let panel;
    let observations;
    let started;

    beforeEach(() => {
        document.body.innerHTML = '<div id="panel"><i></i></div>';
        panel = document.getElementById('panel');
        started = [];
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    /** A module whose source `ticks` delivers occurrences of the type it declares, and records each start. */
    const ticks = payload => new DomqlModule('ticks', {
        types: [{ name: 'tick', fields: { at: 'number', label: 'string?' } }],
        eventTypes: [{ name: 'tick', payload }],
        members: [{ name: 'ticks', function: 'ticks', kind: 'source', on: 'element', parameters: [{ name: 'type', kind: 'value', type: 'string', required: true, fixed: true, selects: 'occurrence', nulls: 'propagate' }], result: 'occurrence<@selected>', changes: 'constant', reads: 'captured' }],
    }, {
        ticks: () => {
            started.push(true);

            return { stop: () => {} };
        },
    });

    const evaluatorOf = (text, bindings = {}, modules = []) => {
        const registry = new ModuleRegistry([BrowserModule.create(), ...modules]);
        const query = Domql.parse(text, bindings);
        const resolved = new LanguageResolver(registry, query.bindings, null, {}).resolveDefinition(query.definition);

        observations = new Observations(registry, { window, document });

        return new QueryEvaluator(registry, resolved, query.bindings, { window, document }, null);
    };

    const failureOf = call => {
        try {
            call();
        } catch (error) {
            return error;
        }

        throw new Error('The call threw nothing');
    };

    /** Captures the occurrence as the subscription's source does, and projects it. */
    const projectionOf = (evaluator, occurrence) => evaluator.project(evaluator.resolveSource().capture(occurrence), { observations });

    describe('the source', () => {
        it('resolves into what starts it: the function, and the receiver and arguments evaluated now', () => {
            const source = evaluatorOf('@panel.ticks("tick") { at }', { panel }, [ticks('tick')]).resolveSource();

            expect(source).toMatchObject({ name: 'ticks', receiver: panel, args: { type: 'tick' }, environment: { window, document } });
            expect(typeof source.start).toBe('function');
            expect(started).toEqual([]);
        });

        it('is null where its receiver is, since there is nothing to listen to', () => {
            expect(evaluatorOf('@panel.first(".none").ticks("tick") { at }', { panel }, [ticks('tick')]).resolveSource()).toBeNull();
        });

        it('is refused for a request that is not a subscription', () => {
            expect(failureOf(() => evaluatorOf('@panel.children.count', { panel }).resolveSource())).toMatchObject({ kind: 'evaluation', message: expect.stringContaining('A query request is not subscribed to') });
        });

        it('captures an occurrence as the fields its type declares, a nullable one it does not carry as null', () => {
            const { capture } = evaluatorOf('@panel.ticks("tick") { at, label }', { panel }, [ticks('tick')]).resolveSource();

            expect(capture({ at: 1, label: 'first', extra: true })).toEqual({ at: 1, label: 'first' });
            expect(capture({ at: 1 })).toEqual({ at: 1, label: null });
            expect(capture({ at: 1, label: 7 })).toEqual({ at: 1, label: null });
        });

        it('fails a capture where the occurrence carries no value a field that is not nullable admits', () => {
            const { capture } = evaluatorOf('@panel.ticks("tick") { at }', { panel }, [ticks('tick')]).resolveSource();

            expect(failureOf(() => capture({ at: 'soon' }))).toMatchObject({ kind: 'evaluation', message: expect.stringContaining("The source 'ticks' delivered an occurrence whose 'at' is \"soon\", and its type declares number") });
            expect(failureOf(() => capture(null))).toMatchObject({ kind: 'evaluation' });
        });

        it('takes an occurrence whole where its type declares no fields, and fails one that is not of its type', () => {
            const { capture } = evaluatorOf('@panel.ticks("tick")', { panel }, [ticks('number')]).resolveSource();

            expect(capture(5)).toBe(5);
            expect(failureOf(() => capture('five'))).toMatchObject({ kind: 'evaluation', message: expect.stringContaining("The source 'ticks' delivered \"five\", and its occurrences are number") });
        });

        it('captures a native event with its target, and null for a target that is no element', () => {
            const { capture } = evaluatorOf('@document.eventsOf("scroll") { id: target.attributeOf("id") }').resolveSource();

            expect(capture(new window.Event('scroll'))).toEqual({ target: null });
            expect(capture({ target: panel })).toEqual({ target: panel });
            expect(capture({ target: document })).toEqual({ target: null });
        });
    });

    describe('an occurrence', () => {
        it('is projected through the shape that follows its source, as detached, immutable data', () => {
            const evaluator = evaluatorOf('@panel.ticks("tick") { at, label, count: @panel.children.count }', { panel }, [ticks('tick')]);
            const projection = projectionOf(evaluator, { at: 3, label: 'third' });

            expect(projection.error).toBeNull();
            expect(projection.value).toEqual({ at: 3, label: 'third', count: 1 });
            expect(Object.isFrozen(projection.value)).toBe(true);
        });

        it('reads what it captured, and the document as it is', () => {
            const evaluator = evaluatorOf('@document.eventsOf("scroll") { id: target.attributeOf("id") }');

            expect(projectionOf(evaluator, { target: panel }).value).toEqual({ id: 'panel' });
            expect(projectionOf(evaluator, { target: document }).value).toEqual({ id: null });
        });

        it('fails its projection where a member fails, without throwing', () => {
            const evaluator = evaluatorOf('@panel.ticks("tick") { match: @panel.matches("[") }', { panel }, [ticks('tick')]);
            const projection = projectionOf(evaluator, { at: 1 });

            expect(projection.value).toBeUndefined();
            expect(projection.error).toMatchObject({ kind: 'evaluation', message: expect.stringContaining("The member 'matches' failed") });
        });

        it('stands for its source, which the projection never starts or reads', () => {
            const evaluator = evaluatorOf('@panel.ticks("tick") { at }', { panel }, [ticks('tick')]);

            projectionOf(evaluator, { at: 1 });
            projectionOf(evaluator, { at: 2 });

            expect(started).toEqual([]);
        });
    });
});
