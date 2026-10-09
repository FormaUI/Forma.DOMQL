import { describe, it, expect } from 'vitest';
import { DomqlModule } from '#domql/language/DomqlModule.mjs';
import { Vocabulary } from '#domql/language/Vocabulary.mjs';
import { declaration, messageOf, parameter } from './declarations.mjs';

describe('DomqlModule', () => {
    it('keeps its declarations as data, without functions', () => {
        const module = new DomqlModule('charts', { declarations: [declaration({ name: 'charts' })] });

        expect(module.functions).toBeNull();
        expect(module.declarations[0].name).toBe('charts');
        expect(Object.isFrozen(module.declarations[0])).toBe(true);
    });

    it('keeps the DOMQL name, the builder and the function key apart', () => {
        const module = new DomqlModule('charts', { declarations: [declaration({ name: 'charts', builder: 'chartsBuilder', function: 'chartsKey' })] }, { chartsKey: () => 0 });

        expect(module.declarations[0]).toMatchObject({ name: 'charts', builder: 'chartsBuilder', function: 'chartsKey' });
    });

    it('requires every function a declaration names', () => {
        expect(messageOf(() => new DomqlModule('charts', { declarations: [declaration({ name: 'charts' })] }, {}))).toContain("'zoom'");
    });

    it('refuses the core identity to any module but the core', () => {
        expect(messageOf(() => new DomqlModule('core', {}))).toContain('core vocabulary');
        expect(Vocabulary.module.isCore).toBe(true);
    });

    it('refuses a declaration without its observation coverage', () => {
        expect(messageOf(() => new DomqlModule('charts', { declarations: [declaration({ changes: undefined })] }))).toContain('how it changes');
        expect(messageOf(() => new DomqlModule('charts', { declarations: [declaration({ changes: 'partly-observable' })] }))).toContain('states the changes it misses');
    });

    it('accepts unobserved coverage', () => {
        expect(() => new DomqlModule('charts', { declarations: [declaration({ name: 'charts', changes: 'unobserved' })] })).not.toThrow();
    });

    it('refuses a required parameter after an optional one', () => {
        const parameters = [parameter({ name: 'first', required: false, default: 1 }), parameter({ name: 'second' })];

        expect(messageOf(() => new DomqlModule('charts', { declarations: [declaration({ parameters })] }))).toContain('follows an optional one');
    });

    it('refuses a default on a required parameter and a fixed parameter that selects nothing', () => {
        expect(messageOf(() => new DomqlModule('charts', { declarations: [declaration({ parameters: [parameter({ default: 1 })] })] }))).toContain('declares no default');
        expect(messageOf(() => new DomqlModule('charts', { declarations: [declaration({ parameters: [parameter({ fixed: true })] })] }))).toContain('what it selects');
    });

    it('refuses an expression parameter without its evaluation context', () => {
        expect(messageOf(() => new DomqlModule('charts', { declarations: [declaration({ parameters: [parameter({ kind: 'expression' })] })] }))).toContain('evaluation context');
    });

    it('refuses a type that is not written as a type', () => {
        expect(messageOf(() => new DomqlModule('charts', { declarations: [declaration({ result: 'list<' })] }))).toContain('type of its result');
    });
});
