import { describe, it, expect } from 'vitest';
import { BrowserModule } from '#domql/dom/BrowserModule.mjs';
import { Vocabulary } from '#domql/language/vocabulary/Vocabulary.mjs';

describe('BrowserModule', () => {
    const module = BrowserModule.create();
    const declared = [...module.members, ...module.predicates, ...module.observationTypes].map(declaration => declaration.function).filter(key => key !== undefined);

    it('is the built-in vocabulary', () => {
        expect(module.isBuiltIn).toBe(true);
        expect(module.members.map(member => member.name)).toEqual(Vocabulary.module.members.map(member => member.name));
    });

    it('carries out every member, answers every predicate and starts every observation type the vocabulary declares', () => {
        for (const key of declared) {
            expect(module.functions[key], key).toBeTypeOf('function');
        }
    });

    it('supplies no function that no declaration names', () => {
        expect(Object.keys(module.functions).sort()).toEqual([...new Set(declared)].sort());
    });

    it('leaves the vocabulary alone declaring, with no function to carry anything out', () => {
        expect(Vocabulary.module.functions).toBeNull();
    });
});
