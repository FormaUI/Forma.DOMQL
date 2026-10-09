import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { Domql } from '#domql/domql.js';

const read = (text, bindings = {}) => Domql.read(Domql.parse(text, bindings));

/** Adds an element with the style to the document, which a real browser lays out. */
const add = (style, parent = document.body) => {
    const element = document.createElement('div');

    element.style.cssText = style;
    parent.append(element);

    return element;
};

describe('Geometry in a browser', () => {
    beforeEach(() => {
        document.body.style.margin = '0';
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    describe('sizes', () => {
        it('measure the border box and the padding box as the browser lays them out', () => {
            const box = add('width: 120px; height: 40px; padding: 10px; border: 2px solid');

            expect(read('@box.size', { box })).toEqual({ width: 144, height: 64 });
            expect(read('@box.clientSize', { box })).toEqual({ width: 140, height: 60 });
        });

        it('keep a fractional size', () => {
            const box = add('width: 10.5px; height: 20.25px');

            expect(read('@box.size', { box })).toEqual({ width: 10.5, height: 20.25 });
        });

        it('are the viewport size for the window', () => {
            const size = read('@window.size');

            expect(size).toEqual({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight });
            expect(size.width).toBeGreaterThan(0);
        });
    });

    describe('rectangles', () => {
        it('are relative to the layout viewport', () => {
            const box = add('position: absolute; left: 30px; top: 50px; width: 100px; height: 20px');

            expect(read('@box.rect', { box })).toEqual({ left: 30, top: 50, right: 130, bottom: 70, width: 100, height: 20 });
        });

        it('are relative to the border box of another element', () => {
            const parent = add('position: absolute; left: 40px; top: 60px; width: 200px; height: 200px');
            const child = add('position: absolute; left: 10px; top: 20px; width: 50px; height: 30px', parent);

            expect(read('@child.rect(relativeTo: @parent)', { child, parent })).toEqual({ left: 10, top: 20, right: 60, bottom: 50, width: 50, height: 30 });
        });

        it('follow a transform', () => {
            const box = add('position: absolute; left: 0; top: 0; width: 100px; height: 50px; transform: translate(15px, 25px)');

            expect(read('@box.rect { left, top, width, height }', { box })).toEqual({ left: 15, top: 25, width: 100, height: 50 });
        });

        it('give the height an aggregate reads', () => {
            const list = add('');

            [48, 64, 48].forEach(height => add(`height: ${height}px`, list));

            expect(read('@list.children.max(rect.height)', { list })).toBe(64);
            expect(read('@list.children.sum(rect.height)', { list })).toBe(160);
        });
    });

    describe('overlap', () => {
        it('compares two boxes, grown by a margin', () => {
            const first = add('position: absolute; left: 0; top: 0; width: 100px; height: 100px');
            const apart = add('position: absolute; left: 110px; top: 0; width: 50px; height: 50px');
            const touching = add('position: absolute; left: 100px; top: 0; width: 50px; height: 50px');
            const across = add('position: absolute; left: 90px; top: 90px; width: 50px; height: 50px');

            expect(read('@first.overlaps @other', { first, other: apart })).toBe(false);
            expect(read('@first.overlaps(@other, margin: 20)', { first, other: apart })).toBe(true);
            expect(read('@first.overlaps @other', { first, other: touching })).toBe(false);
            expect(read('@first.overlaps @other', { first, other: across })).toBe(true);
        });
    });

    describe('a missing layout box', () => {
        it('answers null for a detached element', () => {
            const detached = document.createElement('div');

            expect(read('@box.size', { box: detached })).toBeNull();
            expect(read('@box.rect', { box: detached })).toBeNull();
        });

        it('answers null for display: none, display: contents and a hidden ancestor', () => {
            const none = add('display: none; width: 10px; height: 10px');
            const contents = add('display: contents');
            const hidden = add('display: none');
            const inside = add('width: 10px; height: 10px', hidden);

            for (const box of [none, contents, inside]) {
                expect(read('@box.size', { box })).toBeNull();
                expect(read('@box.rect', { box })).toBeNull();
                expect(read('@box.clientSize', { box })).toBeNull();
                expect(read('@box.is "attached"', { box })).toBe(true);
            }
        });

        it('answers the actual measurements of a box that has no size or is hidden visually', () => {
            const empty = add('width: 0; height: 0');
            const invisible = add('width: 30px; height: 40px; visibility: hidden');
            const transparent = add('width: 30px; height: 40px; opacity: 0');

            expect(read('@box.size', { box: empty })).toEqual({ width: 0, height: 0 });
            expect(read('@box.size', { box: invisible })).toEqual({ width: 30, height: 40 });
            expect(read('@box.size', { box: transparent })).toEqual({ width: 30, height: 40 });
        });

        it('answers null for an overlap with an element that has none', () => {
            const box = add('width: 10px; height: 10px');
            const none = add('display: none');

            expect(read('@box.overlaps @other', { box, other: none })).toBeNull();
        });
    });

    describe('computed styles and grids', () => {
        it('read a custom property and a computed value, and answer null for one that is not set', () => {
            const box = add('--tier: medium; width: 120px');

            expect(read('@box.computedstyle-of "--tier"', { box })).toBe('medium');
            expect(read('@box.computedstyle-of "width"', { box })).toBe('120px');
            expect(read('@box.computedstyle-of "--none"', { box })).toBeNull();
        });

        it('read the sizes of the column tracks of a grid, and none for an element that is no grid', () => {
            const grid = add('display: grid; grid-template-columns: 100px 200px 50px');
            const block = add('');

            expect(read('@grid.grid.columns', { grid })).toEqual([100, 200, 50]);
            expect(read('@grid.grid.columns.count', { grid })).toBe(3);
            expect(read('@block.grid.columns', { block })).toEqual([]);
        });
    });

    describe('state the browser decides', () => {
        it('knows when an element is disabled through its fieldset', () => {
            document.body.innerHTML = '<fieldset disabled><legend><input id="inLegend"></legend><input id="outside"></fieldset><input id="free">';

            const answer = id => read('@input.is "disabled"', { input: document.getElementById(id) });

            expect(answer('outside')).toBe(true);
            expect(answer('inLegend')).toBe(false);
            expect(answer('free')).toBe(false);
        });

        it('knows what is text editable, read only and focused', () => {
            document.body.innerHTML = '<input id="text"><input id="readonly" readonly><input id="checkbox" type="checkbox"><div id="editable" contenteditable="true"><span id="inner"></span></div><div id="plain"></div>';

            const element = id => document.getElementById(id);
            const ask = (id, predicate) => read(`@e.is "${predicate}"`, { e: element(id) });

            expect(ask('text', 'textEditable')).toBe(true);
            expect(ask('readonly', 'textEditable')).toBe(false);
            expect(ask('readonly', 'readOnly')).toBe(true);
            expect(ask('checkbox', 'textEditable')).toBe(false);
            expect(ask('inner', 'textEditable')).toBe(true);
            expect(ask('plain', 'textEditable')).toBe(false);

            expect(ask('text', 'focused')).toBe(false);

            element('text').focus();

            expect(ask('text', 'focused')).toBe(true);
            expect(ask('readonly', 'focused')).toBe(false);
        });

        it('reads the selection of a text control', () => {
            const input = document.createElement('input');

            input.value = 'hello world';
            document.body.append(input);
            input.focus();
            input.setSelectionRange(2, 7);

            expect(read('@input.selection { start, end }', { input })).toEqual({ start: 2, end: 7 });
            expect(read('@input.has "selection"', { input })).toBe(true);
            expect(read('@input.attribute-of "value"', { input })).toBeNull();
        });

        it('answers the window around the document', () => {
            expect(read('@window.devicePixelRatio')).toBeGreaterThan(0);
            expect(read('@window.matches-media "(min-width: 1px)"')).toBe(true);
            expect(read('@window.matches-media "(max-width: 0px)"')).toBe(false);
            expect(read('@document.is "visible"')).toBe(true);
        });
    });
});
