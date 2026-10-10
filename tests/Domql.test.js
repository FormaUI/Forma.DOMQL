import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Domql } from '#domql/domql.js';
import { DomqlError } from '#domql/language/DomqlError.mjs';
import { ParsedTexts } from '#domql/language/ParsedTexts.mjs';

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

        it('reads a member that starts a path with its arguments unparenthesized, as the call it stands for', () => {
            expect(Domql.parse('@target { attributeOf "id" }').definition).toEqual(Domql.parse('@target { attributeOf("id") }').definition);
            expect(Domql.parse('@target { intersects @panel 200 }').definition).toEqual(Domql.parse('@target { intersects(@panel, 200) }').definition);
        });

        it('ends unparenthesized arguments at a comma, so each field keeps its own', () => {
            const { definition } = Domql.parse('@target { key: attributeOf "data-key", selected: matches ".x" }');

            expect(definition.query.fields.map(field => field.name)).toEqual(['key', 'selected']);
            expect(definition.query.fields[0].value.arguments).toEqual([{ value: literal('data-key') }]);
        });

        it('takes unparenthesized arguments across a line break', () => {
            expect(Domql.parse('@target {\n    attributeOf\n    "id"\n}').definition).toEqual(Domql.parse('@target { attributeOf("id") }').definition);
        });

        it('continues from a call whose arguments are parenthesized', () => {
            const { definition } = Domql.parse('@target.intersects(@panel).parent');

            expect(definition.query).toEqual(member('parent', [], member('intersects', [{ value: parameter('panel') }], parameter('target'))));
        });

        it('takes a shape after a call whose arguments are parenthesized', () => {
            const { definition } = Domql.parse('@table.all("tr") { height: rect.height }');

            expect(definition.query.kind).toBe('shape');
            expect(definition.query.target.arguments).toEqual([{ value: literal('tr') }]);
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
            const { definition } = Domql.parse('// A panel.\n@panel { /* its\nfirst item */ first(".item") /* inline */.attributeOf("id") // the id\n}');

            expect(definition.query.fields[0].value).toEqual(member('attributeOf', [{ value: literal('id') }], member('first', [{ value: literal('.item') }])));
        });

        it('keeps comment markers inside a string as text', () => {
            const { definition } = Domql.parse('@target.attributeOf("https://example.com/* not a comment */")');

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

        it('reads a camelCase name as one name and the shorthand\'s literal as its argument', () => {
            const { definition } = Domql.parse('@target { tier: computedStyleOf "--layout-tier", dark: matchesMedia "(prefers-color-scheme: dark)" }');

            expect(definition.query.fields).toEqual([
                { name: 'tier', value: member('computedStyleOf', [{ value: literal('--layout-tier') }]) },
                { name: 'dark', value: member('matchesMedia', [{ value: literal('(prefers-color-scheme: dark)') }]) },
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

    describe('predicate tests', () => {
        const test = (verb, names, target) => (target ? { kind: 'predicate', verb, target, test: names } : { kind: 'predicate', verb, test: names });

        it('test the value of the path before the verb, which a dot binds tighter than', () => {
            expect(Domql.parse('@document is "visible"').definition.query).toEqual(test('is', literal('visible'), parameter('document')));
            expect(Domql.parse('@panel.parent is "attached"').definition.query).toEqual(test('is', literal('attached'), member('parent', [], parameter('panel'))));
            expect(Domql.parse('@input has "selection"').definition.query).toEqual(test('has', literal('selection'), parameter('input')));
        });

        it('test the current value without a subject, inside a shape or an expression', () => {
            const shaped = Domql.parse('@panel { attached: is "attached" }').definition.query;
            const filtered = Domql.parse('@panel.all("input").where(is "disabled")').definition.query;

            expect(shaped.fields[0].value).toEqual(test('is', literal('attached')));
            expect(filtered.arguments[0].value).toEqual(test('is', literal('disabled')));
        });

        it('follow a member whose arguments are unparenthesized', () => {
            expect(Domql.parse('@panel { open: first ".row" is "attached" }').definition.query.fields[0].value).toEqual(test('is', literal('attached'), member('first', [{ value: literal('.row') }])));
        });

        it('combine names under one verb, and binding tighter than or', () => {
            const { query } = Domql.parse('@input is "disabled" or "readOnly" and "textEditable"').definition;

            expect(query.test).toEqual({ kind: 'or', operands: [literal('disabled'), { kind: 'and', operands: [literal('readOnly'), literal('textEditable')] }] });
        });

        it('group names in parentheses', () => {
            const { query } = Domql.parse('@input is ("disabled" or "readOnly") and "textEditable"').definition;

            expect(query.test).toEqual({ kind: 'and', operands: [{ kind: 'or', operands: [literal('disabled'), literal('readOnly')] }, literal('textEditable')] });
        });

        it('gather a run of one operator into one combination', () => {
            expect(Domql.parse('@input has "children" or "selection" or "focus"').definition.query.test.operands).toHaveLength(3);
        });

        it('take names from parameters', () => {
            const { query } = Domql.parse('@panel is @first and @second', { panel: document.body, first: 'attached', second: 'focused' }).definition;

            expect(query.test).toEqual({ kind: 'and', operands: [parameter('first'), parameter('second')] });
        });

        it('name a field after a single literal name, and leave a combined or bound one to be named', () => {
            expect(Domql.parse('@panel { is "attached", has "children", is "scroll.atEnd" }').definition.query.fields.map(field => field.value.test.value)).toEqual(['attached', 'children', 'scroll.atEnd']);

            for (const text of ['@panel { is "disabled" or "readOnly" }', '@panel { is @state }']) {
                expect(getError(() => Domql.parse(text, { panel: document.body, state: 'disabled' })).kind).toBe('structure');
            }

            expect(() => Domql.parse('@panel { unavailable: is "disabled" or "readOnly", state: is @state }', { panel: document.body, state: 'disabled' })).not.toThrow();
        });

        it('are created from a definition as they are parsed from text', () => {
            const parsed = Domql.parse('@input is "disabled" or ("readOnly" and "textEditable")', { input: document.body });

            expect(Domql.create(parsed.definition, { input: document.body }).definition).toEqual(parsed.definition);
        });

        it.each([
            ['a verb other than is or has', test('was', literal('attached'), parameter('panel')), '/query/verb'],
            ['a test of the current value at the top level', test('is', literal('visible')), '/query'],
            ['a name that is no string', test('is', literal(3), parameter('panel')), '/query/test/value'],
            ['a name that is a member', test('is', member('size', [], parameter('panel')), parameter('panel')), '/query/test'],
            ['a combination of one name', test('is', { kind: 'and', operands: [literal('attached')] }, parameter('panel')), '/query/test/operands'],
            ['a combination outside a test', { kind: 'or', operands: [literal('a'), literal('b')] }, '/query'],
        ])('refuse a definition with %s', (_, query, pointer) => {
            const error = getError(() => Domql.create({ version: 1, query }, { panel: document.body }));

            expect(error.kind).toBe('structure');
            expect(error.location.pointer).toBe(pointer);
        });
    });

    describe('syntax', () => {
        it.each([
            ['two fields with no comma between them', '@panel {\n    size\n    clientSize\n}', 3, 5],
            ['an expression argument without parentheses', '@table.max rect.height', 1, 12],
            ['arguments after a dot without parentheses', '@sentinel.intersects @panel 200', 1, 22],
            ['a member with unparenthesized arguments continued by a dot', '@panel { first ".row".rect }', 1, 22],
            ['a member with unparenthesized arguments followed by a shape', '@panel { all "tr" { size } }', 1, 19],
            ['is written as a member', '@target.is "attached"', 1, 9],
            ['a test mixing is and has', '@input is "a" and has "b"', 1, 19],
            ['a predicate named by a number', '@input is 3', 1, 11],
            ['a group of names never closed', '@input is ("a" or "b"', 1, 22],
            ['an operator naming a field', '@panel { is: size }', 1, 10],
            ['an operator naming a parameter', '@and { size }', 1, 2],
            ['a hyphen in a member\'s name', '@panel.attribute-of("id")', 1, 17],
            ['a hyphen in a parameter\'s name', '@my-panel { size }', 1, 4],
            ['a hyphen in a field\'s name', '@panel { is-open: size }', 1, 12],
            ['a hyphen before a digit in a name', '@panel.size-1', 1, 12],
            ['a hyphen ending a name', '@panel.size- ', 1, 12],
            ['an argument after a parenthesized list', '@sentinel.intersects(@panel) 200', 1, 30],
            ['an escape other than \\" or \\\\', '@target.attributeOf("a\\n")', 1, 23],
            ['a string never closed', '@target.attributeOf("id', 1, 21],
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
            ['a field ending in an is of a bound name', '@target { is @name }', '/query/fields/0'],
            ['a field ending in a has of a bound name', '@target { has @name }', '/query/fields/0'],
            ['a field ending in a combined test', '@target { is "disabled" or "readOnly" }', '/query/fields/0'],
            ['a test of the current value at the top level', 'is "visible"', '/query'],
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
            expect(Domql.parse('@target.attributeOf("null")').definition.query.arguments[0].value).toEqual(literal('null'));
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

        it('reads a bound object field by field, a field named __proto__ as an ordinary field of its own', () => {
            const row = JSON.parse('{ "__proto__": { "polluted": true }, "id": "a", "tags": ["x", "y"] }');
            const result = Domql.read('@row', { row });

            expect(Object.keys(result)).toEqual(['__proto__', 'id', 'tags']);
            expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
            expect(Object.getOwnPropertyDescriptor(result, '__proto__').value).toEqual({ polluted: true });
            expect(result.polluted).toBeUndefined();
            expect(Object.isFrozen(result) && Object.isFrozen(result.tags) && Object.isFrozen(result.__proto__)).toBe(true);
            expect(result.tags).not.toBe(row.tags);
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

    describe('a query given as its text', () => {
        it('is read as the query its text parses to, with its bindings and then its options', () => {
            const text = '@panel { count: children.count, id: attributeOf "id" }';

            expect(Domql.read(text, { panel })).toEqual(Domql.read(Domql.parse(text, { panel })));
            expect(Domql.read('@window.devicePixelRatio', {}, { window: { document, devicePixelRatio: 3 } })).toBe(3);
            expect(Domql.read('@window.devicePixelRatio')).toBe(window.devicePixelRatio);
        });

        it('is read the way a parsed query is, through the same cache of parsed texts', () => {
            const text = '@panel.children.count';
            const parse = vi.spyOn(ParsedTexts, 'parse');

            try {
                Domql.read(text, { panel });

                expect(parse).toHaveBeenCalledWith(text);
                expect(parse.mock.results[0].value).toBe(Domql.parse(text, { panel }).definition);
            } finally {
                parse.mockRestore();
            }
        });

        it('fails as parsing fails, and refuses its options given where its bindings go', () => {
            expect(getError(() => Domql.read('@panel {', { panel })).kind).toBe('syntax');
            expect(getError(() => Domql.read('@window.size', { window })).kind).toBe('structure');
            expect(getError(() => Domql.read('@window.size', null)).kind).toBe('structure');
        });

        it('is read once waiting, and watched, as a query is', async () => {
            expect(await Domql.readAsync('@panel.children.count', { panel })).toBe(3);

            const counts = [];
            const watch = Domql.watch('@panel.children.count', { panel }, { onChange: count => counts.push(count), schedule: 'immediate' });

            await watch.refreshAsync();
            watch.dispose();

            expect(counts).toEqual([3]);
        });

        it('rejects a waiting read whose text does not parse, rather than throwing', async () => {
            await expect(Domql.readAsync('@panel {', { panel })).rejects.toThrow(expect.objectContaining({ kind: 'syntax' }));
        });

        it('is resolved as the query its text parses to, with its bindings and then its options', () => {
            expect(Domql.resolve('@panel.size', { panel }).type.toString()).toBe(Domql.resolve(Domql.parse('@panel.size', { panel })).type.toString());
            expect(Domql.resolve('@window.size').type.toString()).toBe('size');
            expect(getError(() => Domql.resolve('@panel.matches(":hover")', { panel }, { watch: true })).kind).toBe('validation');
            expect(Domql.resolve('@panel.matches(":hover")', { panel }, { watch: true, acceptPartialObservation: true }).kind).toBe('query');
        });

        it('is refused with more arguments than its form takes, rather than ignoring them', async () => {
            const query = Domql.parse('@panel.children.count', { panel });

            expect(getError(() => Domql.read('@panel.children.count', { panel }, {}, {}))).toMatchObject({ kind: 'structure', message: 'Domql.read takes a text, its bindings and its options, and was given 4 arguments' });
            expect(getError(() => Domql.read(query, { panel }, {}))).toMatchObject({ kind: 'structure', message: expect.stringContaining('Domql.read takes a query and its options, and was given 3 arguments; a query carries its own bindings') });
            expect(getError(() => Domql.watch(query, { panel }, { onChange: () => {} }))).toMatchObject({ kind: 'structure', message: expect.stringContaining('Domql.watch takes a query and its configuration') });
            expect(getError(() => Domql.resolve(query, {}, {})).kind).toBe('structure');
            await expect(Domql.readAsync(query, {}, {})).rejects.toThrow(expect.objectContaining({ kind: 'structure' }));
        });

        it('is watched with its bindings always second, {} where it has none', async () => {
            const counts = [];
            const watch = Domql.watch('@window.devicePixelRatio', {}, { onChange: ratio => counts.push(ratio), schedule: 'immediate' });

            await watch.refreshAsync();
            watch.dispose();

            expect(counts).toEqual([window.devicePixelRatio]);
            expect(getError(() => Domql.watch('@window.devicePixelRatio', { onChange: () => {} })).kind).toBe('structure');
        });

        it('is refused when it is neither a query nor text', () => {
            for (const request of [42, null, { definition: {} }]) {
                const error = getError(() => Domql.read(request));

                expect(error.kind).toBe('structure');
                expect(error.message).toBe('Expected a query created by this DOMQL instance. To reuse a query from another instance, pass its definition and a plain object of bindings to Domql.create.');
            }
        });
    });

    describe('a request of another kind', () => {
        const subscription = () => Domql.parse('@panel.eventsOf("click") { button }', { panel });

        it('is refused with a validation error by the call that does not carry it out, naming what the call does', () => {
            expect(getError(() => Domql.read(subscription()))).toMatchObject({ kind: 'validation', message: expect.stringContaining('A subscription request is not read'), location: { pointer: '/query', line: 1 } });
            expect(getError(() => Domql.watch(subscription(), { onChange: () => {} }))).toMatchObject({ kind: 'validation', message: expect.stringContaining('A subscription request is not watched') });
            expect(getError(() => Domql.subscribe('@panel.children.count', { panel }, { onEvent: () => {} }))).toMatchObject({ kind: 'validation', message: expect.stringContaining('A query request is not subscribed to') });
        });

        it('is refused by a waiting read, which rejects with the validation error', async () => {
            await expect(Domql.readAsync(subscription())).rejects.toThrow(expect.objectContaining({ kind: 'validation', message: expect.stringContaining('A subscription request is not read') }));
        });

        it('is refused after resolution and before anything needs a window', () => {
            expect(getError(() => Domql.read(subscription(), { window: null })).kind).toBe('validation');
            expect(getError(() => Domql.read(Domql.parse('@panel.nonsense', { panel }), { window: null })).kind).toBe('validation');
        });
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

        it('is made again for other options, and for bindings of other types or other selecting values', () => {
            const query = Domql.parse('@panel.size', { panel });
            const before = Domql.resolve(query);

            expect(Domql.resolve(query, { watch: true })).not.toBe(before);
            expect(Domql.resolve(Domql.parse('@panel.size', { panel: Domql.bind(null, 'element?') }))).not.toBe(before);
            expect(Domql.resolve('@panel.eventsOf(@type) { button }', { panel, type: 'click' })).not.toBe(Domql.resolve('@panel.eventsOf(@type) { button }', { panel, type: 'pointerdown' }));
        });

        it('is shared by the queries of one definition whose bindings have the same types', () => {
            const other = document.createElement('div');

            expect(Domql.resolve(Domql.parse('@panel.size', { panel: other }))).toBe(Domql.resolve(Domql.parse('@panel.size', { panel })));
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
        members: [{ name, function: name, kind: 'property', on: 'element', parameters: [], result: 'number', changes: 'constant', reads: 'fresh' }],
    }, { [name]: () => 7 });

    it('fail inside an item of a list where the failing member is written', () => {
        isolated.registerModule(isolated.createModule('weight', {
            members: [{ name: 'weight', function: 'weight', kind: 'property', on: 'element', parameters: [], result: 'number', changes: 'constant', reads: 'fresh' }],
        }, {
            weight: element => {
                if (element.hasAttribute('aria-selected')) {
                    throw new Error('heavy');
                }

                return 1;
            },
        }));
        document.body.innerHTML = '<div id="panel"><div data-key="a1"></div><div data-key="a2" aria-selected="true"></div></div>';

        const error = getError(() => isolated.read('@panel.all("[data-key]") {\n    key: attributeOf "data-key",\n    weight: weight\n}', { panel: document.getElementById('panel') }));

        expect(error.kind).toBe('evaluation');
        expect(error.location).toEqual({ pointer: '/query/fields/1/value', offset: 72, line: 3, column: 13 });
        document.body.innerHTML = '';
    });

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

describe('Domql instances', () => {
    // Each test loads another instance of Domql beside the one imported, as an independently bundled library would.
    let other;
    let panel;

    beforeEach(async () => {
        vi.resetModules();
        ({ Domql: other } = await import('#domql/domql.js'));

        document.body.innerHTML = '<section id="panel"><p></p><p></p></section>';
        panel = document.getElementById('panel');
    });

    it('refuse a query another instance made, saying how to reuse it', async () => {
        const query = other.parse('@panel.children.count', { panel });
        const message = 'Expected a query created by this DOMQL instance. To reuse a query from another instance, pass its definition and a plain object of bindings to Domql.create.';

        expect(getError(() => Domql.read(query))).toMatchObject({ kind: 'structure', message });
        expect(getError(() => Domql.resolve(query))).toMatchObject({ kind: 'structure', message });
        expect(getError(() => Domql.watch(query, { onChange: () => {} }))).toMatchObject({ kind: 'structure', message });
        expect(getError(() => Domql.subscribe(other.parse('@panel.eventsOf("click") { button }', { panel }), { onEvent: () => {} }))).toMatchObject({ kind: 'structure', message });
        await expect(Domql.readAsync(query)).rejects.toThrow(message);
    });

    it('reuse a query from its definition and a plain object of bindings, resolved against their own vocabulary', () => {
        other.registerModule(other.createModule('zoom', {
            members: [{ name: 'zoom', function: 'zoom', kind: 'property', on: 'element', parameters: [], result: 'number', changes: 'constant', reads: 'fresh' }],
        }, { zoom: () => 7 }));

        const count = other.parse('@panel.children.count', { panel });
        const zoom = other.parse('@panel.zoom', { panel });

        expect(Domql.read(Domql.create(count.definition, { panel }))).toBe(2);
        expect(other.read(zoom)).toBe(7);
        expect(getError(() => Domql.resolve(Domql.create(zoom.definition, { panel }))).kind).toBe('validation');
    });

    it('take a typed binding made by this instance, and refuse one another instance made', () => {
        const { definition } = other.parse('@title', { title: other.bind(null, 'string?') });

        expect(Domql.read(Domql.create(definition, { title: Domql.bind(null, 'string?') }))).toBeNull();
        expect(getError(() => Domql.create(definition, { title: other.bind(null, 'string?') })).kind).toBe('structure');
    });
});

describe('Domql readAsync', () => {
    // Each test loads its own copy of Domql, with a registry of its own.
    let isolated;
    let panel;
    let gauges;
    let stuck;
    let reported;

    /** Lets the observations deliver and the reads that wait on them evaluate again. */
    const settle = () => new Promise(resolve => setTimeout(resolve));

    beforeEach(async () => {
        vi.resetModules();
        ({ Domql: isolated } = await import('#domql/domql.js'));
        document.body.innerHTML = '<div id="panel"><b></b><b></b><b></b></div>';
        panel = document.getElementById('panel');
        gauges = new Map();
        stuck = new Set();
        reported = [];
        window.reportError = error => reported.push(error);

        // A member kept by an observation whose samples the test supplies, one gauge for each element; one the test marks stuck fails to stop.
        isolated.registerModule(isolated.createModule('level', {
            observationTypes: [{ name: 'level', contract: 'maintained', function: 'observeLevel' }],
            members: [
                {
                    name: 'level', function: 'level', kind: 'property', on: 'element', parameters: [], result: 'number?',
                    changes: 'observable', reads: 'maintained', observations: [{ type: 'level', of: 'receiver' }],
                },
            ],
        }, {
            observeLevel: ({ target }, notify) => {
                const gauge = { sample: { pending: true, value: null }, started: 0, stopped: 0, notify };

                gauges.set(target, gauge);
                gauge.started++;

                const stop = () => {
                    gauge.stopped++;

                    if (stuck.has(target)) {
                        throw new Error('stuck');
                    }
                };

                return { stop, sample: () => gauge.sample };
            },
            level: (_receiver, _args, _environment, [sample]) => sample,
        }));
        isolated.registerModule(isolated.createModule('boom', {
            members: [{ name: 'boom', function: 'boom', kind: 'property', on: 'element', parameters: [], result: 'number', changes: 'constant', reads: 'fresh' }],
        }, { boom: () => { throw new Error('no'); } }));
    });

    /** Gives the gauge of the element its first or next sample. */
    const sample = (element, value) => {
        const gauge = gauges.get(element);

        gauge.sample = { pending: false, value };
        gauge.notify();
    };

    it('answers what read answers for a query that reads nothing maintained', async () => {
        const query = isolated.parse('@panel { count: children.count, id: attributeOf "id" }', { panel });

        expect(await isolated.readAsync(query)).toEqual(isolated.read(query));
        expect(Object.isFrozen(await isolated.readAsync(query))).toBe(true);
    });

    it('waits for the first sample of a maintained member, and read does not', async () => {
        const query = isolated.parse('@item.level', { item: panel.children[0] });
        let answer;

        expect(getError(() => isolated.read(query)).message).toContain("The member 'level' is maintained by an observation");

        const reading = isolated.readAsync(query).then(value => { answer = value; });

        await settle();

        expect(answer).toBeUndefined();

        sample(panel.children[0], 7);
        await reading;

        expect(answer).toBe(7);
    });

    it('evaluates again for a maintained member that a later evaluation introduces', async () => {
        const [first, second, third] = panel.children;
        const query = isolated.parse('@panel.children.at(@first.level).level', { panel, first });
        let answer;

        const reading = isolated.readAsync(query).then(value => { answer = value; });

        await settle();
        sample(first, 2);
        await settle();

        // The sample picked the third child, whose gauge the answer waits for in turn.
        expect(answer).toBeUndefined();
        expect(gauges.has(third)).toBe(true);
        expect(gauges.has(second)).toBe(false);

        sample(third, 9);
        await reading;

        expect(answer).toBe(9);
    });

    it('lets go of every observation it started when it answers', async () => {
        const query = isolated.parse('{ a: @a.level, b: @b.level }', { a: panel.children[0], b: panel.children[1] });
        const reading = isolated.readAsync(query);

        await settle();
        sample(panel.children[0], 1);
        sample(panel.children[1], 2);

        expect(await reading).toEqual({ a: 1, b: 2 });
        expect([...gauges.values()].map(gauge => [gauge.started, gauge.stopped])).toEqual([[1, 1], [1, 1]]);
    });

    it('is canceled by its signal, fails with its reason and lets go of what it started', async () => {
        const controller = new AbortController();
        const reading = isolated.readAsync(isolated.parse('@item.level', { item: panel.children[0] }), { signal: controller.signal });
        const failure = reading.catch(error => error);

        await settle();
        controller.abort(new Error('not needed'));

        expect((await failure).message).toBe('not needed');
        expect(gauges.get(panel.children[0]).stopped).toBe(1);
    });

    it('fails at once for a signal that is already aborted, starting nothing', async () => {
        const controller = new AbortController();

        controller.abort();

        await expect(isolated.readAsync(isolated.parse('@item.level', { item: panel.children[0] }), { signal: controller.signal })).rejects.toThrow();
        expect(gauges.size).toBe(0);
    });

    it('fails with the error of an evaluation and lets go of what it started', async () => {
        const item = panel.children[0];
        const failure = isolated.readAsync(isolated.parse('{ a: @item.level, b: @item.boom }', { item })).catch(error => error);

        await settle();
        sample(item, 1);

        const error = await failure;

        expect(error.name).toBe('DomqlError');
        expect(error.message).toContain("The member 'boom' failed");
        expect(gauges.get(item).stopped).toBe(1);
    });

    it('fails without a browser window', async () => {
        const error = await isolated.readAsync(isolated.parse('@window.devicePixelRatio'), { window: null }).catch(failure => failure);

        expect(error.name).toBe('DomqlError');
        expect(error.kind).toBe('evaluation');
    });

    describe('cleanup that fails', () => {
        it('is reported, and keeps the result of a read that succeeded', async () => {
            const [first, second] = panel.children;
            const reading = isolated.readAsync(isolated.parse('{ a: @a.level, b: @b.level }', { a: first, b: second }));

            stuck.add(first);
            await settle();
            sample(first, 1);
            sample(second, 2);

            expect(await reading).toEqual({ a: 1, b: 2 });
            expect(gauges.get(second).stopped).toBe(1);
            expect(reported.map(error => error.message)).toEqual(['stuck']);
        });

        it('is reported, and leaves the read failing with the error of its evaluation', async () => {
            const item = panel.children[0];
            const failure = isolated.readAsync(isolated.parse('{ a: @item.level, b: @item.boom }', { item })).catch(error => error);

            stuck.add(item);
            await settle();
            sample(item, 1);

            expect((await failure).message).toContain("The member 'boom' failed");
            expect(reported.map(error => error.message)).toEqual(['stuck']);
        });

        it("is reported, and leaves a canceled read failing with the signal's reason", async () => {
            const controller = new AbortController();
            const item = panel.children[0];
            const failure = isolated.readAsync(isolated.parse('@item.level', { item }), { signal: controller.signal }).catch(error => error);

            stuck.add(item);
            await settle();
            controller.abort(new Error('not needed'));

            expect((await failure).message).toBe('not needed');
            expect(reported.map(error => error.message)).toEqual(['stuck']);
        });
    });
});

describe('Domql runAsync', () => {
    // Each test loads its own copy of Domql, with a registry of its own.
    let isolated;
    let panel;
    let reported;
    let runs;
    let pending;

    /** An action module: its one member, named for it, on an element, carried out by the function. */
    const action = (name, implementation, { parameters = [], result = 'boolean' } = {}) => isolated.createModule(name, {
        members: [{ name, function: name, kind: 'action', on: 'element', parameters, result, changes: 'unobserved', reads: 'fresh' }],
    }, { [name]: implementation });

    const label = [{ name: 'label', kind: 'value', type: 'string', required: true, nulls: 'propagate' }];

    beforeEach(async () => {
        vi.resetModules();
        ({ Domql: isolated } = await import('#domql/domql.js'));
        document.body.innerHTML = '<div id="panel"><b id="first"></b></div>';
        panel = document.getElementById('panel');
        reported = [];
        runs = [];
        pending = null;
        window.reportError = error => reported.push(error);

        // Marks its element and answers whether the mark changed.
        isolated.registerModule(action('mark', (element, { label }, _environment, { signal }) => {
            runs.push({ element, label, signal });

            const changed = element.dataset.mark !== label;

            element.dataset.mark = label;

            return changed;
        }, { parameters: label }));

        // Answers a promise the test settles, after marking its element as started.
        isolated.registerModule(action('slow', (element, _args, _environment, { signal }) => {
            element.dataset.state = 'started';
            runs.push({ element, signal });

            return new Promise((resolve, reject) => { pending = { resolve, reject }; });
        }));

        isolated.registerModule(action('pick', element => element.firstElementChild, { result: 'element?' }));
        isolated.registerModule(action('broken', element => {
            element.dataset.state = 'half';

            throw new Error('jammed');
        }));
        isolated.registerModule(action('wrong', () => 'yes'));
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('runs an action once and returns its result, as text or as a request', async () => {
        expect(await isolated.runAsync('@panel.mark(@label)', { panel, label: 'seen' })).toBe(true);
        expect(await isolated.runAsync(isolated.parse('@panel.mark("seen")', { panel }))).toBe(false);
        expect(panel.dataset.mark).toBe('seen');
        expect(runs.map(run => run.label)).toEqual(['seen', 'seen']);
    });

    it('waits for a result the action promises, and gives the action a signal even where the caller gave none', async () => {
        const running = isolated.runAsync('@panel.slow', { panel });

        await Promise.resolve();
        pending.resolve(true);

        expect(await running).toBe(true);
        expect(runs[0].signal).toBeInstanceOf(AbortSignal);
        expect(runs[0].signal.aborted).toBe(false);
    });

    it('shapes the result by the shape that follows the action, as immutable data', async () => {
        const result = await isolated.runAsync('@panel.pick { id: attributeOf "id" }', { panel });

        expect(result).toEqual({ id: 'first' });
        expect(Object.isFrozen(result)).toBe(true);
    });

    it('runs nothing where the receiver is null, and answers null', async () => {
        expect(await isolated.runAsync('@item.mark("seen")', { item: isolated.bind(null, 'element?') })).toBeNull();
        expect(runs).toEqual([]);
    });

    it('rejects a result of another type than the action declares, naming the action', async () => {
        await expect(isolated.runAsync('@panel.wrong', { panel })).rejects.toThrow(expect.objectContaining({ kind: 'evaluation', message: expect.stringContaining("The action 'wrong' answered \"yes\", and it declares boolean") }));
    });

    it('rejects a failure of the action with what it threw as the cause, and leaves what it changed', async () => {
        const error = await isolated.runAsync('@panel.broken', { panel }).catch(failure => failure);

        expect(error).toMatchObject({ kind: 'evaluation', message: expect.stringContaining("The action 'broken' failed: jammed") });
        expect(error.cause.message).toBe('jammed');
        expect(panel.dataset.state).toBe('half');
        expect(reported).toEqual([]);
    });

    it('rejects a failure the action promises, whatever it is', async () => {
        const running = isolated.runAsync('@panel.slow', { panel }).catch(failure => failure);

        await Promise.resolve();
        pending.reject(null);

        const error = await running;

        expect(error).toMatchObject({ kind: 'evaluation', message: expect.stringContaining("The action 'slow' failed: null") });
        expect(error.cause).toBeNull();
    });

    it('rejects with the reason of a signal already aborted, and runs nothing', async () => {
        const controller = new AbortController();

        controller.abort(new Error('not now'));

        await expect(isolated.runAsync('@panel.mark("seen")', { panel }, { signal: controller.signal })).rejects.toThrow('not now');
        expect(runs).toEqual([]);
    });

    it('rejects at once with the reason of a signal that aborts while the action runs, which learns of it, and discards its result', async () => {
        const controller = new AbortController();
        const running = isolated.runAsync('@panel.slow', { panel }, { signal: controller.signal }).catch(failure => failure);

        await Promise.resolve();
        controller.abort(new Error('stop'));

        expect((await running).message).toBe('stop');
        expect(runs[0].signal.aborted).toBe(true);
        expect(panel.dataset.state).toBe('started');

        pending.resolve(true);
        await Promise.resolve();

        expect(reported).toEqual([]);
    });

    it('reports a failure that arrives after the run was canceled, since no caller waits for it', async () => {
        const controller = new AbortController();
        const running = isolated.runAsync('@panel.slow', { panel }, { signal: controller.signal }).catch(failure => failure);

        await Promise.resolve();
        controller.abort(new Error('stop'));
        await running;
        pending.reject(new Error('late'));
        await new Promise(resolve => setTimeout(resolve));

        expect(reported).toHaveLength(1);
        expect(reported[0]).toMatchObject({ kind: 'evaluation', message: expect.stringContaining("The action 'slow' failed: late") });
    });

    it('is refused for a request of another kind, and an action request is refused by the other calls', async () => {
        await expect(isolated.runAsync('@panel.children.count', { panel })).rejects.toThrow(expect.objectContaining({ kind: 'validation', message: expect.stringContaining('A query request is not run') }));
        expect(getError(() => isolated.read('@panel.mark("seen")', { panel }))).toMatchObject({ kind: 'validation', message: expect.stringContaining('An action request is not read') });
        expect(runs).toEqual([]);
    });

    it('rejects where its receiver or arguments cannot be evaluated, and runs nothing', async () => {
        await expect(isolated.runAsync('@panel.first("[").mark("seen")', { panel })).rejects.toThrow(expect.objectContaining({ kind: 'evaluation', message: expect.stringContaining("The member 'first' failed") }));
        expect(runs).toEqual([]);
    });
});
