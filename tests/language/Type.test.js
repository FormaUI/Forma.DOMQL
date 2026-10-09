import { describe, it, expect } from 'vitest';
import { Type } from '#domql/language/Type.mjs';

describe('Type', () => {
    describe('parse', () => {
        it.each([
            ['number', 'named', 'number', false],
            ['element?', 'named', 'element', true],
            ['rectangle', 'named', 'rectangle', false],
            ['T', 'variable', 'T', false],
            ['T?', 'variable', 'T', true],
            ['@selected', 'variable', '@selected', false],
            ['null', 'null', null, true],
        ])('reads %s', (text, kind, name, isNullable) => {
            const type = Type.parse(text);

            expect(type).toMatchObject({ kind, name, isNullable });
        });

        it('reads lists and occurrences by their items', () => {
            expect(Type.parse('list<number>').item.name).toBe('number');
            expect(Type.parse('list<T>?')).toMatchObject({ kind: 'list', isNullable: true });
            expect(Type.parse('occurrence<@selected>').item.kind).toBe('variable');
            expect(Type.parse('list<list<element?>>').item.item.isNullable).toBe(true);
        });

        it.each(['', 'list', 'list<>', 'list<number', 'number<number>', '1number', 'a-b', 'list<number>>', 'number?!', null, 5])('refuses %s', text => {
            expect(Type.parse(text)).toBeNull();
        });

        it('answers one type for one notation', () => {
            expect(Type.parse('list<number>')).toBe(Type.parse('list<number>'));
        });
    });

    describe('toString', () => {
        it.each(['number', 'element?', 'list<T>', 'list<element>?', 'occurrence<@selected>', 'null'])('writes %s back as it was read', text => {
            expect(Type.parse(text).toString()).toBe(text);
        });

        it('writes a shape by its fields', () => {
            expect(Type.shape(new Map([['width', Type.named('number')]])).toString()).toBe('{ width: number }');
        });
    });

    describe('unify', () => {
        it('binds a variable to the part of the type it stands for', () => {
            const bindings = new Map();

            expect(Type.unify(Type.parse('list<T>'), Type.parse('list<element>'), bindings)).toBe(true);
            expect(bindings.get('T').toString()).toBe('element');
        });

        it('keeps an item\'s nullability when it binds', () => {
            const bindings = new Map();

            Type.unify(Type.parse('list<T>'), Type.parse('list<number?>'), bindings);

            expect(bindings.get('T').toString()).toBe('number?');
        });

        it.each([
            ['list<T>', 'number'],
            ['list<T>', 'occurrence<number>'],
            ['element', 'window'],
            ['rectangle', 'size'],
        ])('refuses %s against %s', (pattern, actual) => {
            expect(Type.unify(Type.parse(pattern), Type.parse(actual), new Map())).toBe(false);
        });

        it('requires a variable met twice to stand for one type', () => {
            const bindings = new Map([['T', Type.parse('number')]]);

            expect(Type.unify(Type.parse('T'), Type.parse('number?'), bindings)).toBe(true);
            expect(Type.unify(Type.parse('T'), Type.parse('string'), bindings)).toBe(false);
        });
    });

    describe('substitute', () => {
        it('replaces a bound variable, keeping the nullability the pattern wrote', () => {
            const bindings = new Map([['T', Type.parse('element')]]);

            expect(Type.substitute(Type.parse('T?'), bindings).toString()).toBe('element?');
            expect(Type.substitute(Type.parse('list<T>'), bindings).toString()).toBe('list<element>');
            expect(Type.substitute(Type.parse('number'), bindings).toString()).toBe('number');
        });

        it('leaves a variable nothing bound', () => {
            expect(Type.substitute(Type.parse('U'), new Map()).toString()).toBe('U');
        });
    });

    describe('isAssignable', () => {
        it.each([
            ['number', 'number', true],
            ['number', 'number?', true],
            ['number?', 'number', false],
            ['number?', 'number?', true],
            ['null', 'number?', true],
            ['null', 'number', false],
            ['number', 'string', false],
            ['list<number>', 'list<number>', true],
            ['list<number>', 'list<number?>', true],
            ['list<number?>', 'list<number>', false],
            ['list<number>', 'list<string>', false],
            ['number', 'list<number>', false],
            ['element', 'window', false],
        ])('answers %s to %s as %s', (actual, expected, answer) => {
            expect(Type.isAssignable(Type.parse(actual), Type.parse(expected))).toBe(answer);
        });
    });

    it('converts between nullable and non-nullable', () => {
        expect(Type.parse('number').toNullable().toString()).toBe('number?');
        expect(Type.parse('number?').toNonNullable().toString()).toBe('number');
        expect(Type.null.toNonNullable()).toBe(Type.null);
    });
});
