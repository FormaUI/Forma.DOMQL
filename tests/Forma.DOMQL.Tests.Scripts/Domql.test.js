import { describe, it, expect } from 'vitest';
import { Domql } from '#domql/Domql.js';

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
            expect(Domql.parse('@target.closest ".row".attribute "id"').definition).toEqual(Domql.parse('@target.closest(".row").attribute("id")').definition);
        });

        it('takes the shorthand\'s literal across a line break', () => {
            expect(Domql.parse('@target.attribute\n    "id"').definition).toEqual(Domql.parse('@target.attribute("id")').definition);
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
            const { definition } = Domql.parse('// A panel.\n@panel { /* its\nfirst item */ first(".item") /* inline */.attribute "id" // the id\n}');

            expect(definition.query.fields[0].value).toEqual(member('attribute', [{ value: literal('id') }], member('first', [{ value: literal('.item') }])));
        });

        it('keeps comment markers inside a string as text', () => {
            const { definition } = Domql.parse('@target.attribute "https://example.com/* not a comment */"');

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
            const { definition } = Domql.parse('@target { bounds: get "RECT", get "CLIENTSIZE" }');

            expect(definition.query.fields).toEqual([
                { name: 'bounds', value: member('get', [{ value: literal('RECT') }]) },
                { value: member('get', [{ value: literal('CLIENTSIZE') }]) },
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
            ['an escape other than \\" or \\\\', '@target.attribute "a\\n"', 1, 21],
            ['a string never closed', '@target.attribute "id', 1, 19],
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
            ['two fields named alike', '@target { width: rect.width, Width: size.width }', '/query/fields/1'],
            ['two fields inferring one name', '@target { rect.width, size.width }', '/query/fields/1'],
            ['a field inferring the name another is written with', '@target { get "RECT", rect }', '/query/fields/1'],
            ['a field holding a parameter alone', '{ @panel }', '/query/fields/0'],
            ['a field holding a literal alone', '@panel { "list" }', '/query/fields/0'],
            ['a field ending in a get of a bound name', '@target { get(@name) }', '/query/fields/0'],
            ['a positional argument after a named one', '@target.rect(relativeTo: @other, 1)', '/query/arguments/1'],
            ['a path at the top level starting with a member', 'rect.width', '/query/target'],
            ['a field of a top-level shape starting with a member', '{ width: rect.width }', '/query/fields/0/value/target'],
            ['a reserved literal in another case naming a member', '@panel.NULL', '/query/name'],
            ['a reserved literal in another case naming a field', '@panel { True: size }', '/query/fields/0/name'],
            ['a reserved literal in another case naming a parameter', '@FALSE { size }', '/query/target/name'],
        ])('rejects %s, naming where', (_, text, pointer) => {
            const error = getError(() => Domql.parse(text));

            expect(error.kind).toBe('structure');
            expect(error.location.pointer).toBe(pointer);
            expect(error.location.line).toBe(1);
        });

        it('keeps a reserved word inside a string as an ordinary string', () => {
            expect(Domql.parse('@target.attribute "null"').definition.query.arguments[0].value).toEqual(literal('null'));
        });

        it('accepts a field continuing past a get of a bound name', () => {
            expect(Domql.parse('@target { get(@name).width }').definition.query.fields).toHaveLength(1);
        });

        it('accepts a member at the start of an argument, whose current value its member decides', () => {
            expect(() => Domql.parse('@list.all("li").where(intersects(root: @list)).count')).not.toThrow();
        });

        it('locates a failure on the line it is written on', () => {
            const error = getError(() => Domql.parse('@target {\n    width: rect.width,\n    WIDTH: size.width\n}'));

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
            ['a name that is no name', { version: 1, query: parameter('my-panel') }, '/query/name'],
            ['a reserved literal naming a parameter', { version: 1, query: parameter('Null') }, '/query/name'],
            ['a reserved literal naming a member', { version: 1, query: member('true', [], parameter('panel')) }, '/query/name'],
            ['a reserved literal naming a field', { version: 1, query: { kind: 'shape', target: parameter('panel'), fields: [{ name: 'FALSE', value: member('size') }] } }, '/query/fields/0/name'],
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
        it('looks a binding up regardless of case', () => {
            const element = document.createElement('div');
            const query = Domql.parse('@Panel { size }', { panel: element });

            expect(query.bindings.get('PANEL')).toBe(element);
            expect(query.bindings.has('panel')).toBe(true);
        });

        it('binds data: numbers, strings, Booleans, null, lists and objects', () => {
            const configuration = { modifier: 'shift', steps: [1, 2], wrap: true, limit: null };

            expect(Domql.parse('@target { size }', { target: configuration }).bindings.get('target')).toBe(configuration);
        });

        it.each([
            ['a root', { Document: 1 }],
            ['the page in any case', { PAGE: 1 }],
            ['two names differing only in case', { panel: 1, Panel: 2 }],
            ['a name that is no name', { 'my-panel': 1 }],
            ['a reserved literal in any case', { Null: 1 }],
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
