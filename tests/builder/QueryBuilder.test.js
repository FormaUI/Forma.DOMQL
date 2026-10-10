import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Domql } from '#domql/domql.js';
import { LanguageResolver } from '#domql/language/LanguageResolver.mjs';

/** The error a call throws. */
const getError = call => {
    try {
        call();
    } catch (error) {
        return error;
    }

    throw new Error('The call threw nothing');
};

describe('QueryBuilder', () => {
    let panel;
    let other;

    beforeEach(() => {
        document.body.innerHTML = '<div id="panel" data-key="k"><i id="a"></i><i id="b"></i></div><div id="other"></div>';
        panel = document.getElementById('panel');
        other = document.getElementById('other');
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    describe('a built query', () => {
        /** The text that writes each construct, the bindings it names, and the build that writes it fluently. */
        const constructs = () => [
            ['a property', '@p1.size', { p1: panel }, q => q.from(panel).size],
            ['a member called with an argument', '@p1.attributeOf("data-key")', { p1: panel }, q => q.from(panel).attributeOf('data-key')],
            ['arguments by name, an element among them bound', '@p1.intersects(root: @p2, margin: 10)', { p1: panel, p2: other }, q => q.from(panel).intersects({ root: other, margin: 10 })],
            ['arguments by position, then by name', '@p1.intersects(@p2, margin: 5)', { p1: panel, p2: other }, q => q.from(panel).intersects(other, { margin: 5 })],
            ['a shape of a value', '@p1 { size: size, key: attributeOf("data-key") }', { p1: panel }, q => q.from(panel).select(view => ({ size: view.size, key: view.attributeOf('data-key') }))],
            ['a nested shape and literal fields', '@p1 { box: { width: size.width }, kind: "panel", rank: 3, none: null }', { p1: panel }, q => q.from(panel).select(view => ({ box: { width: view.size.width }, kind: 'panel', rank: 3, none: null }))],
            ['a shape of each item of a list', '@p1.children { id: attributeOf("id") }', { p1: panel }, q => q.from(panel).children.select(item => ({ id: item.attributeOf('id') }))],
            ['expressions over the items of a list', '@document { attached: @p1.children.where(is "attached").count, widest: @p1.children.max(size.width), total: @p1.children.sum(size.width), narrowest: @p1.children.min(size.width) }', { p1: panel },
                q => q.from(document).select(() => ({
                    attached: q.from(panel).children.where(item => item.is('attached')).count,
                    widest: q.from(panel).children.max(item => item.size.width),
                    total: q.from(panel).children.sum(item => item.size.width),
                    narrowest: q.from(panel).children.min(item => item.size.width),
                }))],
            ['a test of a value, its names combined', '@p1 is ("attached" or "focused") and "disabled"', { p1: panel }, q => q.from(panel).is('(attached or focused) and disabled')],
            ['a test of the current value, and has', '@p1 { open: is "attached", full: has "children" }', { p1: panel }, q => q.from(panel).select(view => ({ open: view.is('attached'), full: view.has('children') }))],
            ['the roots', '@window { ratio: devicePixelRatio, visible: @document is "visible" }', {}, q => q.from(window).select(view => ({ ratio: view.devicePixelRatio, visible: q.from(document).is('visible') }))],
            ['another target inside a projection', '@window { ratio: devicePixelRatio, width: @p1.size.width }', { p1: panel }, q => q.from(window).select(view => ({ ratio: view.devicePixelRatio, width: q.from(panel).size.width }))],
            ['an occurrence source, shaped', '@p1.eventsOf("click") { button: button, x: clientX }', { p1: panel }, q => q.from(panel).eventsOf('click').select(event => ({ button: event.button, x: event.clientX }))],
            ['a member read by name', '@p1.get("size")', { p1: panel }, q => q.from(panel).get('size')],
        ];

        it.each(constructs().map(([name]) => [name]))('writes the definition the text parses to: %s', name => {
            const [, text, bindings, build] = constructs().find(construct => construct[0] === name);
            const built = Domql.build(build);

            expect(built.definition).toEqual(Domql.parse(text, bindings).definition);
            expect(Object.fromEntries(Object.keys(bindings).map(key => [key, built.bindings.get(key)]))).toEqual(bindings);
        });

        it('reads as the parsed query does', () => {
            const built = Domql.build(q => q.from(panel).select(view => ({ key: view.attributeOf('data-key'), ids: view.children.select(item => ({ id: item.attributeOf('id') })) })));

            expect(Domql.read(built)).toEqual({ key: 'k', ids: [{ id: 'a' }, { id: 'b' }] });
        });

        it('works with `from` taken from the builder', () => {
            expect(Domql.read(Domql.build(({ from }) => from(panel).attributeOf('data-key')))).toBe('k');
        });
    });

    describe('bindings', () => {
        it('are named in the order the build meets them, one name for a value met twice', () => {
            const built = Domql.build(q => q.from(panel).select(view => ({ a: view.intersects({ root: other }), b: q.from(other).size, c: q.from(panel).size })));

            expect(built.bindings.get('p1')).toBe(panel);
            expect(built.bindings.get('p2')).toBe(other);
            expect(built.bindings.has('p3')).toBe(false);
        });

        it('take the name an object gives a target, which the value keeps wherever the build meets it again', () => {
            const built = Domql.build(q => q.from({ panel }).select(view => ({ near: view.intersects({ root: other }), same: view.overlaps(panel) })));

            expect(Domql.parse('@panel { near: intersects(root: @p1), same: overlaps(@panel) }', { panel, p1: other }).definition).toEqual(built.definition);
            expect(Domql.resolve(Domql.create(built.definition, { panel: other, p1: panel })).kind).toBe('query');
        });

        it('take a typed binding where the value would be', () => {
            const built = Domql.build(q => q.from({ panel: Domql.bind(null, 'element?') }).size);

            expect(Domql.read(built)).toBeNull();
        });

        it('refuse one name for two values, and one value under two names', () => {
            expect(getError(() => Domql.build(q => q.from({ panel }).select(() => ({ a: q.from({ panel: other }).size }))))).toMatchObject({ kind: 'structure', message: expect.stringContaining("The name 'panel' is given to two values") });
            expect(getError(() => Domql.build(q => q.from({ panel }).select(() => ({ a: q.from({ again: panel }).size }))))).toMatchObject({ kind: 'structure', message: expect.stringContaining("bound twice, as 'panel' and as 'again'") });
        });
    });

    describe('the callback contract', () => {
        it('refuses arithmetic, concatenation and comparisons over an expression', () => {
            expect(getError(() => Domql.build(q => q.from(panel).select(view => ({ w: view.size.width + 1 }))))).toMatchObject({ kind: 'structure', message: expect.stringContaining('holds no value yet') });
            expect(getError(() => Domql.build(q => q.from(panel).select(view => ({ w: `${view.size.width}px` }))))).toMatchObject({ kind: 'structure' });
            expect(getError(() => Domql.build(q => q.from(panel).select(view => ({ w: view.size.width > 3 }))))).toMatchObject({ kind: 'structure' });
        });

        it('refuses true and false where `!` and `===` over an expression answer them', () => {
            expect(getError(() => Domql.build(q => q.from(panel).select(view => ({ hidden: !view.is('attached') }))))).toMatchObject({ kind: 'structure', message: expect.stringContaining("The field 'hidden'") });
            expect(getError(() => Domql.build(q => q.from(panel).children.where(item => item.size === null).count))).toMatchObject({ kind: 'structure', message: expect.stringContaining('An expression answers a path') });
        });

        it('refuses a callback that answers no path, a projection that answers no object, and the current value as a field', () => {
            expect(getError(() => Domql.build(() => ({ a: 1 })))).toMatchObject({ kind: 'structure', message: expect.stringContaining('a path that starts at `q.from`') });
            expect(getError(() => Domql.build(q => q.from(panel).select(() => 'all')))).toMatchObject({ kind: 'structure', message: expect.stringContaining('returns an object') });
            expect(getError(() => Domql.build(q => q.from(panel).select(view => ({ me: view }))))).toMatchObject({ kind: 'structure', message: expect.stringContaining('never the current value itself') });
            expect(getError(() => Domql.build('@panel.size'))).toMatchObject({ kind: 'structure' });
        });

        it('refuses a start that is no target, a call of what is no member, and a member called twice', () => {
            expect(getError(() => Domql.build(q => q.from('#panel').size))).toMatchObject({ kind: 'structure', message: expect.stringContaining('`q.from` starts at') });
            expect(getError(() => Domql.build(q => q.from(panel)()))).toMatchObject({ kind: 'structure', message: expect.stringContaining('`@p1` is not one') });
            expect(getError(() => Domql.build(q => q.from(panel).attributeOf('id')('class')))).toMatchObject({ kind: 'structure', message: expect.stringContaining('Only a member is called, and once') });
        });

        it('refuses a test whose names cannot be read', () => {
            expect(getError(() => Domql.build(q => q.from(panel).is('attached or')))).toMatchObject({ kind: 'structure', message: expect.stringContaining('it ends where a name should be') });
            expect(getError(() => Domql.build(q => q.from(panel).is('(attached')))).toMatchObject({ kind: 'structure', message: expect.stringContaining('never closed') });
            expect(getError(() => Domql.build(q => q.from(panel).is('a-b')))).toMatchObject({ kind: 'structure' });
        });
    });

    describe('a failure the vocabulary finds', () => {
        it('is reported as the query is built, naming the part as DOMQL text and the member it is an argument of', () => {
            const error = getError(() => Domql.build(q => q.from(panel).children.where(item => item.intersect({ root: other })).count));

            expect(error.kind).toBe('validation');
            expect(error.location).toMatchObject({ part: 'intersect(root: @p2)', within: 'where' });
            expect(error.message).toContain('in `intersect(root: @p2)` inside `where`');
        });

        it('names a misspelled member of a path by the path that reaches it', () => {
            const error = getError(() => Domql.build(q => q.from(panel).sise.width));

            expect(error).toMatchObject({ kind: 'validation', location: { part: '@p1.sise' } });
        });
    });

    describe('building again', () => {
        it('shares the definition, and its resolution, with the query built alike for other elements', () => {
            const build = target => Domql.build(q => q.from(target).children.select(item => ({ id: item.attributeOf('id') })));
            const first = build(panel);
            const resolutions = vi.spyOn(LanguageResolver.prototype, 'resolveDefinition');

            try {
                const second = build(other);

                expect(second.definition).toBe(first.definition);
                expect(Domql.resolve(second)).toBe(Domql.resolve(first));
                expect(Domql.read(second)).toEqual([]);
                expect(resolutions).not.toHaveBeenCalled();
            } finally {
                resolutions.mockRestore();
            }
        });
    });
});

describe('QueryBuilder with every call', () => {
    // Each test loads its own copy of Domql, with a registry of its own.
    let isolated;
    let panel;

    beforeEach(async () => {
        vi.resetModules();
        ({ Domql: isolated } = await import('#domql/domql.js'));
        document.body.innerHTML = '<div id="panel" data-n="1"><i></i></div>';
        panel = document.getElementById('panel');
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('takes the document and the window given as arguments as the roots, as `q.from` does', () => {
        isolated.registerModule(isolated.createModule('inside', {
            members: [{ name: 'inside', function: 'inside', kind: 'operation', on: 'element', parameters: [{ name: 'of', kind: 'value', type: 'document', required: true, nulls: 'propagate' }], result: 'boolean', changes: 'unobserved', reads: 'fresh' }],
        }, { inside: (element, { of }) => element.ownerDocument === of }));

        const built = isolated.build(q => q.from(panel).inside(document));

        expect(built.definition).toEqual(isolated.parse('@p1.inside(@document)', { p1: panel }).definition);
        expect(isolated.read(built)).toBe(true);
    });

    it('watches, subscribes, runs and activates a built query as a parsed one', async () => {
        const marks = [];

        isolated.registerModule(isolated.createModule('mark', {
            members: [{ name: 'mark', function: 'mark', kind: 'action', on: 'element', parameters: [], result: 'boolean', changes: 'unobserved', reads: 'fresh' }],
        }, { mark: element => { marks.push(element); return true; } }));
        isolated.registerModule(isolated.createModule('glow', {
            members: [{ name: 'glow', function: 'glow', kind: 'behavior', on: 'element', parameters: [], result: 'null', changes: 'unobserved', reads: 'fresh' }],
        }, { glow: element => { element.dataset.glow = 'on'; return { update: () => {}, dispose: () => delete element.dataset.glow }; } }));

        const snapshots = [];
        const watch = isolated.watch(isolated.build(q => q.from(panel).attributeOf('data-n')), { onChange: value => snapshots.push(value), schedule: 'immediate' });

        await watch.refreshAsync();
        watch.dispose();

        const events = [];
        const listener = isolated.subscribe(isolated.build(q => q.from(panel).eventsOf('input').select(event => ({ id: event.target.attributeOf('data-n') }))), { onEvent: result => events.push(result) });

        panel.dispatchEvent(new window.Event('input'));
        listener.dispose();

        const behavior = isolated.activate(isolated.build(q => q.from(panel).glow));
        const glowing = panel.dataset.glow;

        behavior.dispose();

        expect(snapshots).toEqual(['1']);
        expect(events).toEqual([{ id: '1' }]);
        expect(await isolated.runAsync(isolated.build(q => q.from(panel).mark))).toBe(true);
        expect(marks).toEqual([panel]);
        expect(glowing).toBe('on');
        expect(panel.dataset.glow).toBeUndefined();
    });
});
