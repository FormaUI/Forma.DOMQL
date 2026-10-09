import { beforeEach, describe, it, expect, vi } from 'vitest';
import { Domql } from '#domql/domql.js';
import { DomqlError } from '#domql/language/DomqlError.mjs';

/** The error a call throws. */
const getError = call => {
    try {
        call();
    } catch (error) {
        return error;
    }

    throw new Error('The call threw nothing');
};

const member = (name, args = [], target) => (target
    ? { kind: 'member', target, name, arguments: args }
    : { kind: 'member', name, arguments: args });

const literal = value => ({ kind: 'literal', value });
const parameter = name => ({ kind: 'parameter', name });

describe('Domql', () => {
    describe('parse', () => {
        it('reads the specification\'s example into its definition', () => {
            const query = Domql.parse('@panel { size, hasFocus: matches(":focus-within") }');

            expect(query.definition).toEqual({
                version: 1,
                query: {
                    kind: 'shape',
                    target: parameter('panel'),
                    fields: [
                        { value: member('size') },
                        { name: 'hasFocus', value: member('matches', [{ value: literal(':focus-within') }]) },
                    ],
                },
            });
        });

        it('reads a path as a chain of targets', () => {
            const { definition } = Domql.parse('@panel.all("li").count');

            expect(definition.query).toEqual(member('count', [], member('all', [{ value: literal('li') }], parameter('panel'))));
        });

        it('reads the one-literal shorthand as the call it stands for', () => {
            expect(Domql.parse('@target.is "attached"').definition).toEqual(Domql.parse('@target.is("attached")').definition);
            expect(Domql.parse('@target.closest ".row".attribute-of "id"').definition).toEqual(Domql.parse('@target.closest(".row").attribute-of("id")').definition);
        });

        it('reads several literals and parameters after a member as its arguments in order', () => {
            const { definition } = Domql.parse('@sentinel.intersects @panel 200');

            expect(definition).toEqual(Domql.parse('@sentinel.intersects(@panel, 200)').definition);
            expect(definition.query.arguments).toEqual([{ value: parameter('panel') }, { value: literal(200) }]);
        });

        it('ends unparenthesized arguments at a comma, so each field keeps its own', () => {
            const { definition } = Domql.parse('{ nearEnd: @sentinel.intersects @panel 200, visible: @document.is "visible" }');

            expect(definition.query.fields.map(field => field.name)).toEqual(['nearEnd', 'visible']);
            expect(definition.query.fields[1].value.arguments).toEqual([{ value: literal('visible') }]);
        });

        it('continues a dot after unparenthesized arguments from the call\'s result', () => {
            const { definition } = Domql.parse('@target.intersects @panel.parent');

            expect(definition.query).toEqual(member('parent', [], member('intersects', [{ value: parameter('panel') }], parameter('target'))));
        });

        it('takes a shape after unparenthesized arguments', () => {
            const { definition } = Domql.parse('@table.all "tr" { height: rect.height }');

            expect(definition.query.kind).toBe('shape');
            expect(definition.query.target.arguments).toEqual([{ value: literal('tr') }]);
        });

        it('takes the shorthand\'s literal across a line break', () => {
            expect(Domql.parse('@target.attribute-of\n    "id"').definition).toEqual(Domql.parse('@target.attribute-of("id")').definition);
        });

        it('reads named arguments in order and allows a comma after the last', () => {
            const { definition } = Domql.parse('@sentinel.intersects(root: @panel, margin: 200,)');

            expect(definition.query.arguments).toEqual([
                { name: 'root', value: parameter('panel') },
                { name: 'margin', value: literal(200) },
            ]);
        });

        it('reads every kind of literal', () => {
            const { definition } = Domql.parse('{ a: "say \\"hi\\" \\\\", b: -1.5e2, c: 0, d: true, e: false, f: null }');

            expect(definition.query.fields.map(field => field.value.value)).toEqual(['say "hi" \\', -150, 0, true, false, null]);
        });

        it('skips line and block comments', () => {
            const { definition } = Domql.parse('// A panel.\n@panel { /* its\nfirst item */ first(".item") /* inline */.attribute-of "id" // the id\n}');

            expect(definition.query.fields[0].value).toEqual(member('attribute-of', [{ value: literal('id') }], member('first', [{ value: literal('.item') }])));
        });

        it('keeps comment markers inside a string as text', () => {
            const { definition } = Domql.parse('@target.attribute-of "https://example.com/* not a comment */"');

            expect(definition.query.arguments[0].value).toEqual(literal('https://example.com/* not a comment */'));
        });

        it('closes a block comment at its first */, so comments do not nest', () => {
            expect(getError(() => Domql.parse('@panel { /* outer /* inner */ still a comment */ size }')).kind).toBe('syntax');
        });

        it('reads a shape following no value as one keeping the current value', () => {
            const { definition } = Domql.parse('@panel { layout: { width: size.width } }');

            expect(definition.query.fields[0]).toEqual({
                name: 'layout',
                value: { kind: 'shape', fields: [{ name: 'width', value: member('width', [], member('size')) }] },
            });
        });

        it('keeps names as they are written, and an inferred name out of the definition', () => {
            const { definition } = Domql.parse('@target { bounds: get "rect", get "clientSize" }');

            expect(definition.query.fields).toEqual([
                { name: 'bounds', value: member('get', [{ value: literal('rect') }]) },
                { value: member('get', [{ value: literal('clientSize') }]) },
            ]);
        });

        it('reads a hyphenated name as one name and the shorthand\'s literal as its argument', () => {
            const { definition } = Domql.parse('@target { tier: computedstyle-of "--layout-tier", dark: matches-media "(prefers-color-scheme: dark)" }');

            expect(definition.query.fields).toEqual([
                { name: 'tier', value: member('computedstyle-of', [{ value: literal('--layout-tier') }]) },
                { name: 'dark', value: member('matches-media', [{ value: literal('(prefers-color-scheme: dark)') }]) },
            ]);
        });

        it('freezes the definition', () => {
            const { definition } = Domql.parse('@panel { size }');

            expect(Object.isFrozen(definition)).toBe(true);
            expect(Object.isFrozen(definition.query.fields[0].value.arguments)).toBe(true);
        });

        it('shares one definition between parses of the same text', () => {
            const first = Domql.parse('@panel { size, clientSize }', { panel: 1 });
            const second = Domql.parse('@panel { size, clientSize }', { panel: 2 });

            expect(second.definition).toBe(first.definition);
            expect(second.bindings.get('panel')).toBe(2);
        });

        it('rejects text that is no string', () => {
            expect(() => Domql.parse(null)).toThrow(TypeError);
        });
    });

    describe('syntax', () => {
        it.each([
            ['two fields with no comma between them', '@panel {\n    size\n    clientSize\n}', 3, 5],
            ['an expression argument without parentheses', '@table.max rect.height', 1, 12],
            ['a nested call as an unparenthesized argument', '@table.where is "x"', 1, 14],
            ['an argument after a parenthesized list', '@sentinel.intersects(@panel) 200', 1, 30],
            ['an escape other than \\" or \\\\', '@target.attribute-of "a\\n"', 1, 24],
            ['a string never closed', '@target.attribute-of "id', 1, 22],
            ['a character outside the language', '@target.size + 1', 1, 14],
            ['a parameter with no name', '@ { size }', 1, 3],
            ['a query that ends too soon', '@panel {', 1, 9],
            ['a reserved literal naming a field', '@panel { null: size }', 1, 10],
            ['a block comment never closed', '@panel { size /* the size', 1, 15],
            ['a single slash', '@panel.size / 2', 1, 13],
            ['a # comment, which DOMQL has none of', '# A panel.\n@panel { size }', 1, 1],
            ['a reserved literal naming an argument', '@panel.rect(true: @other)', 1, 13],
            ['a reserved literal naming a parameter', '@false { size }', 1, 2],
        ])('rejects %s, naming where', (_, text, line, column) => {
            const error = getError(() => Domql.parse(text));

            expect(error.name).toBe('DomqlError');
            expect(error.kind).toBe('syntax');
            expect(error.location).toMatchObject({ line, column });
        });
    });

    describe('structure', () => {
        it.each([
            ['an empty shape', '@panel {}', '/query'],
            ['two fields named alike', '@target { width: rect.width, width: size.width }', '/query/fields/1'],
            ['two fields inferring one name', '@target { rect.width, size.width }', '/query/fields/1'],
            ['a field inferring the name another is written with', '@target { get "rect", rect }', '/query/fields/1'],
            ['a field holding a parameter alone', '{ @panel }', '/query/fields/0'],
            ['a field holding a literal alone', '@panel { "list" }', '/query/fields/0'],
            ['a field ending in a get of a bound name', '@target { get(@name) }', '/query/fields/0'],
            ['a field ending in an is of a bound name', '@target { is(@name) }', '/query/fields/0'],
            ['a field ending in a has of a bound name', '@target { has(@name) }', '/query/fields/0'],
            ['a predicate inferring the name another field is written with', '@target { disabled: size, is "disabled" }', '/query/fields/1'],
            ['a positional argument after a named one', '@target.rect(relativeTo: @other, 1)', '/query/arguments/1'],
            ['two named arguments alike', '@sentinel.intersects(root: @panel, root: @other)', '/query/arguments/1'],
            ['a path at the top level starting with a member', 'rect.width', '/query/target'],
            ['a field of a top-level shape starting with a member', '{ width: rect.width }', '/query/fields/0/value/target'],
        ])('rejects %s, naming where', (_, text, pointer) => {
            const error = getError(() => Domql.parse(text));

            expect(error.kind).toBe('structure');
            expect(error.location.pointer).toBe(pointer);
            expect(error.location.line).toBe(1);
        });

        it('keeps a reserved word inside a string as an ordinary string', () => {
            expect(Domql.parse('@target.attribute-of "null"').definition.query.arguments[0].value).toEqual(literal('null'));
        });

        it('lets get, is and has infer the last segment of the name they read', () => {
            const { definition } = Domql.parse('@target { is "disabled", is "readOnly", has "children", get "grid.columns", is "scroll.atEnd" }');

            expect(definition.query.fields.map(field => field.name)).toEqual([undefined, undefined, undefined, undefined, undefined]);
            expect(() => Domql.parse('@target { is "disabled", get "disabled" }')).toThrow(/named 'disabled'/);
        });

        it('accepts a field continuing past a get of a bound name', () => {
            expect(Domql.parse('@target { get(@name).width }').definition.query.fields).toHaveLength(1);
        });

        it('accepts a member at the start of an argument, whose current value its member decides', () => {
            expect(() => Domql.parse('@list.all("li").where(intersects(root: @list)).count')).not.toThrow();
        });

        it('locates a failure on the line it is written on', () => {
            const error = getError(() => Domql.parse('@target {\n    width: rect.width,\n    width: size.width\n}'));

            expect(error.location).toMatchObject({ pointer: '/query/fields/1', line: 3, column: 5 });
        });
    });

    describe('create', () => {
        it('creates the query its text parses into', () => {
            const parsed = Domql.parse('@panel { size, hasFocus: matches(":focus-within") }', { panel: 1 });
            const created = Domql.create(parsed.definition, { panel: 2 });

            expect(created.definition).toEqual(parsed.definition);
            expect(created.bindings.get('panel')).toBe(2);
        });

        it('copies and freezes the definition it is given', () => {
            const definition = { version: 1, query: { kind: 'shape', target: parameter('panel'), fields: [{ value: member('size') }] } };
            const query = Domql.create(definition);

            definition.query.fields.push({ value: member('clientSize') });

            expect(query.definition.query.fields).toHaveLength(1);
            expect(Object.isFrozen(query.definition.query)).toBe(true);
        });

        it.each([
            ['a version other than 1', { version: 2, query: parameter('panel') }, '/version'],
            ['a property no part has', { version: 1, query: { ...parameter('panel'), extra: true } }, '/query'],
            ['an unknown kind', { version: 1, query: { kind: 'call', name: 'size' } }, '/query'],
            ['a member without arguments', { version: 1, query: { kind: 'member', target: parameter('panel'), name: 'size' } }, '/query'],
            ['a name that is no name', { version: 1, query: parameter('2panel') }, '/query/name'],
            ['a name ending in a hyphen', { version: 1, query: parameter('panel-') }, '/query/name'],
            ['a reserved literal naming a parameter', { version: 1, query: parameter('null') }, '/query/name'],
            ['a reserved literal naming a member', { version: 1, query: member('true', [], parameter('panel')) }, '/query/name'],
            ['a reserved literal naming a field', { version: 1, query: { kind: 'shape', target: parameter('panel'), fields: [{ name: 'false', value: member('size') }] } }, '/query/fields/0/name'],
            ['a reserved literal naming an argument', { version: 1, query: member('rect', [{ name: 'null', value: parameter('other') }], parameter('panel')) }, '/query/arguments/0/name'],
            ['a literal that is no JSON scalar', { version: 1, query: literal(Number.NaN) }, '/query/value'],
            ['a shape whose fields are no array', { version: 1, query: { kind: 'shape', target: parameter('panel'), fields: {} } }, '/query/fields'],
        ])('rejects %s, naming its node', (_, definition, pointer) => {
            const error = getError(() => Domql.create(definition));

            expect(error.kind).toBe('structure');
            expect(error.location).toEqual({ pointer });
        });
    });

    describe('bindings', () => {
        it('looks a binding up by the exact name', () => {
            const element = document.createElement('div');
            const query = Domql.parse('@panel { size }', { panel: element, Panel: 2 });

            expect(query.bindings.get('panel')).toBe(element);
            expect(query.bindings.get('Panel')).toBe(2);
            expect(query.bindings.has('PANEL')).toBe(false);
        });

        it('types a binding by what its value reveals', () => {
            const { bindings } = Domql.parse('@target { size }', { target: document.createElement('div'), count: 3, ids: [1, 2], row: { id: 'a', parent: document.createElement('div') } });

            expect(bindings.typeOf('target').kind).toBe('element');
            expect(bindings.typeOf('count').kind).toBe('number');
            expect(bindings.typeOf('ids')).toMatchObject({ kind: 'list', item: { kind: 'number' } });
            expect(bindings.typeOf('row')).toMatchObject({ kind: 'object' });
        });

        it.each([
            ['null', null],
            ['an empty list', []],
            ['a list of items of different types', [1, 'two']],
            ['a list holding a null', [1, null]],
            ['an object holding a null', { id: 'a', parent: null }],
        ])('requires a declared type for %s', (_, value) => {
            const error = getError(() => Domql.parse('@target { size }', { target: value }));

            expect(error.kind).toBe('structure');
            expect(error.location).toEqual({ binding: 'target' });
        });

        it.each([
            ['an unavailable element', null, 'element?'],
            ['an empty list', [], 'list<number>'],
            ['a list holding a null', [1, null], 'list<number?>'],
            ['an object holding a null', { id: 'a', parent: null }, '{ id: string, parent: element? }'],
            ['a nested list', [[1], []], 'list<list<number>>'],
        ])('accepts %s declared as its type', (_, value, type) => {
            const { bindings } = Domql.parse('@target { size }', { target: Domql.bind(value, type) });

            expect(bindings.get('target')).toBe(value);
            expect(bindings.typeOf('target')).toBeDefined();
        });

        it.each([
            ['mixed items under a list of one type', [1, 'two'], 'list<number>'],
            ['a null under a type that is not nullable', null, 'element'],
            ['an element where a number is declared', document.createElement('div'), 'number'],
            ['an object field of another type', { id: 1 }, '{ id: string }'],
            ['an object with a field the type lacks', { id: 'a', extra: 1 }, '{ id: string }'],
            ['a type that is no type', 1, 'integer'],
            ['a type with an unclosed list', [1], 'list<number'],
        ])('rejects %s', (_, value, type) => {
            expect(getError(() => Domql.parse('@target { size }', { target: Domql.bind(value, type) })).kind).toBe('structure');
        });

        it('supplies the type again through create', () => {
            const parsed = Domql.parse('@target { size }', { target: Domql.bind(null, 'element?') });
            const created = Domql.create(parsed.definition, { target: Domql.bind(document.createElement('div'), 'element?') });

            expect(created.bindings.typeOf('target')).toMatchObject({ kind: 'element', isNullable: true });
        });

        it('treats a root or a reserved literal in another case as an ordinary name', () => {
            expect(() => Domql.parse('@Window { size }', { Window: 1, Document: 2, Null: 3 })).not.toThrow();
        });

        it('binds data: numbers, strings, Booleans, null, lists and objects', () => {
            const configuration = { modifier: 'shift', steps: [1, 2], wrap: true };

            expect(Domql.parse('@target { size }', { target: configuration }).bindings.get('target')).toBe(configuration);
        });

        it.each([
            ['a root', { document: 1 }],
            ['the window', { window: 1 }],
            ['a name that is no name', { '2panel': 1 }],
            ['a name with a hyphen at its end', { 'panel-': 1 }],
            ['a reserved literal', { null: 1 }],
            ['a function', { panel: () => {} }],
            ['an object that is no plain data', { panel: new Date() }],
            ['a number that is not finite', { panel: Number.POSITIVE_INFINITY }],
        ])('rejects %s', (_, bindings) => {
            expect(getError(() => Domql.parse('@target { size }', bindings)).kind).toBe('structure');
        });

        it.each([
            ['a list', []],
            ['a map, whose entries are no properties', new Map([['target', 1]])],
        ])('rejects bindings given as %s', (_, bindings) => {
            expect(getError(() => Domql.parse('@target { size }', bindings)).kind).toBe('structure');
        });
    });
});

describe('Domql reads', () => {
    let panel;

    beforeEach(() => {
        document.body.innerHTML = '<div id="panel"><i></i><i></i><i></i></div>';
        panel = document.getElementById('panel');
    });

    describe('the environment', () => {
        it('is reported when there is no browser window', () => {
            const query = Domql.parse('@window.devicePixelRatio');
            const error = getError(() => Domql.read(query, { window: null }));

            expect(error).toBeInstanceOf(DomqlError);
            expect(error.kind).toBe('evaluation');
            expect(error.message).toContain('without a browser window');
            expect(getError(() => Domql.read(query, { window: {} })).kind).toBe('evaluation');
        });

        it('leaves parsing and resolving to work without one', () => {
            expect(Domql.resolve(Domql.parse('@window.size')).type.toString()).toBe('size');
        });
    });

    describe('resolution', () => {
        it('is kept for a query and used by every read of it', () => {
            const query = Domql.parse('@panel.children.count', { panel });

            expect(Domql.resolve(query)).toBe(Domql.resolve(query));
            expect(Domql.read(query)).toBe(3);

            panel.append(document.createElement('i'));

            expect(Domql.read(query)).toBe(4);
        });

        it('is made again for other options and for other bindings', () => {
            const query = Domql.parse('@panel.size', { panel });
            const before = Domql.resolve(query);

            expect(Domql.resolve(query, { watch: true })).not.toBe(before);
            expect(Domql.resolve(Domql.parse('@panel.size', { panel }))).not.toBe(before);
        });

        it('is not kept for a query that fails to resolve', () => {
            const query = Domql.parse('@panel.nonsense', { panel });

            expect(getError(() => Domql.resolve(query)).kind).toBe('validation');
            expect(getError(() => Domql.resolve(query)).kind).toBe('validation');
        });
    });
});

describe('Domql modules', () => {
    // Each test loads its own copy of Domql, with a registry of its own.
    let isolated;

    beforeEach(async () => {
        vi.resetModules();
        ({ Domql: isolated } = await import('#domql/domql.js'));
    });

    const module = name => isolated.createModule(name, {
        members: [{ name, builder: name, function: name, kind: 'property', on: 'element', parameters: [], result: 'number', changes: 'constant', reads: 'fresh' }],
    }, { [name]: () => 7 });

    it('make the members they declare available to the queries resolved afterwards', () => {
        const element = document.createElement('div');

        expect(getError(() => isolated.resolve(isolated.parse('@panel.zoom', { panel: element }))).kind).toBe('validation');

        isolated.registerModule(module('zoom'));

        expect(isolated.resolve(isolated.parse('@panel.zoom', { panel: element })).type.toString()).toBe('number');
    });

    it('replace the resolutions made against the vocabulary before them', () => {
        const query = isolated.parse('@panel.children.count', { panel: document.createElement('div') });
        const before = isolated.resolve(query);

        isolated.registerModule(module('zoom'));

        expect(isolated.resolve(query)).not.toBe(before);
    });

    it('are registered once under a name', () => {
        isolated.registerModule(module('zoom'));

        expect(getError(() => isolated.registerModule(module('zoom'))).kind).toBe('module');
    });

    it('leave the registry of another copy of Domql alone', () => {
        isolated.registerModule(module('zoom'));

        expect(getError(() => Domql.resolve(Domql.parse('@panel.zoom', { panel: document.createElement('div') }))).kind).toBe('validation');
    });
});
