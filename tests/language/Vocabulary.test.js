import { describe, it, expect } from 'vitest';
import { Registry } from '#domql/language/Registry.mjs';
import { Vocabulary } from '#domql/language/Vocabulary.mjs';

describe('Vocabulary', () => {
    const registry = new Registry([Vocabulary.module]);
    const names = [
        'size', 'devicePixelRatio', 'rect', 'clientSize', 'grid', 'selection', 'children', 'parent', 'count', 'first', 'last',
        'matches-media', 'supports', 'is', 'has', 'attribute-of', 'computedstyle-of', 'intersects', 'overlaps', 'matches', 'closest',
        'all', 'get', 'at', 'max', 'min', 'sum', 'where', 'events-of',
    ];

    it('declares each member the specification lists', () => {
        expect(names.filter(name => registry.getMembers(name).length === 0)).toEqual([]);
    });

    it('gives every member observation coverage and, where partial, what it misses', () => {
        for (const member of Vocabulary.module.members) {
            expect(member.changes).toBeTypeOf('string');
            expect(member.changes === 'partly-observable' ? member.misses : 'n/a').toBeTruthy();
        }
    });

    it('names every function key a module of functions would supply', () => {
        const keys = Vocabulary.module.members.map(member => `${member.on}:${member.name}:${member.function}`);

        expect(new Set(keys).size).toBe(keys.length);
    });

    it('declares is and has predicates in separate namespaces', () => {
        expect(registry.getPredicate('is', 'disabled')).toBeDefined();
        expect(registry.getPredicate('has', 'disabled')).toBeUndefined();
        expect(registry.getPredicate('has', 'children')).toBeDefined();
    });
});
