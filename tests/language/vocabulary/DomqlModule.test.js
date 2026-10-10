import { describe, it, expect } from 'vitest';
import { DomqlModule } from '#domql/language/vocabulary/DomqlModule.mjs';
import { Vocabulary } from '#domql/language/vocabulary/Vocabulary.mjs';
import { declaration, messageOf, parameter } from './declarations.mjs';

describe('DomqlModule', () => {
    it('keeps its declarations as data, without functions', () => {
        const module = new DomqlModule('charts', { members: [declaration({ name: 'charts' })] });

        expect(module.functions).toBeNull();
        expect(module.members[0].name).toBe('charts');
        expect(Object.isFrozen(module.members[0])).toBe(true);
    });

    it('refuses a name with a hyphen, which no name holds', () => {
        expect(messageOf(() => new DomqlModule('charts', { members: [declaration({ name: 'chart-size', function: 'chartSize' })] }))).toContain('named as a name is');
        expect(messageOf(() => new DomqlModule('chart-tools', {}))).toContain('named as a name is');
    });

    it('keeps the DOMQL name and the function key apart', () => {
        const module = new DomqlModule('charts', { members: [declaration({ name: 'charts', function: 'chartsKey' })] }, { chartsKey: () => 0 });

        expect(module.members[0]).toMatchObject({ name: 'charts', function: 'chartsKey' });
    });

    it('requires every function a declaration names', () => {
        expect(messageOf(() => new DomqlModule('charts', { members: [declaration({ name: 'charts' })] }, {}))).toContain("'zoom'");
    });

    it('refuses the built-in identity to any module but the built-in one', () => {
        expect(messageOf(() => new DomqlModule('builtIn', {}))).toContain('built-in module');
        expect(Vocabulary.module.isBuiltIn).toBe(true);
    });

    it('refuses a declaration without its observation coverage', () => {
        expect(messageOf(() => new DomqlModule('charts', { members: [declaration({ changes: undefined })] }))).toContain('how it changes');
        expect(messageOf(() => new DomqlModule('charts', { members: [declaration({ changes: 'partly-observable' })] }))).toContain('states the changes it misses');
    });

    it('takes a tolerance that is a number that is not negative', () => {
        expect(() => new DomqlModule('charts', { members: [declaration({ name: 'charts', changes: 'unobserved', tolerance: 0.5 })] })).not.toThrow();
        expect(() => new DomqlModule('charts', { members: [declaration({ name: 'charts', changes: 'unobserved', tolerance: 0 })] })).not.toThrow();

        for (const tolerance of [-1, '1', Infinity, null]) {
            expect(messageOf(() => new DomqlModule('charts', { members: [declaration({ name: 'charts', changes: 'unobserved', tolerance })] }))).toContain('tolerance');
        }
    });

    it('accepts unobserved coverage', () => {
        expect(() => new DomqlModule('charts', { members: [declaration({ name: 'charts', changes: 'unobserved' })] })).not.toThrow();
    });

    it('refuses a required parameter after an optional one', () => {
        const parameters = [parameter({ name: 'first', required: false, default: 1 }), parameter({ name: 'second' })];

        expect(messageOf(() => new DomqlModule('charts', { members: [declaration({ parameters })] }))).toContain('follows an optional one');
    });

    it('refuses a default on a required parameter and a fixed parameter that selects nothing', () => {
        expect(messageOf(() => new DomqlModule('charts', { members: [declaration({ parameters: [parameter({ default: 1 })] })] }))).toContain('declares no default');
        expect(messageOf(() => new DomqlModule('charts', { members: [declaration({ parameters: [parameter({ fixed: true })] })] }))).toContain('what it selects');
    });

    it('refuses an expression parameter without its evaluation context', () => {
        expect(messageOf(() => new DomqlModule('charts', { members: [declaration({ parameters: [parameter({ kind: 'expression' })] })] }))).toContain('evaluation context');
    });

    it('refuses a type that is not written as a type', () => {
        expect(messageOf(() => new DomqlModule('charts', { members: [declaration({ result: 'list<' })] }))).toContain('type of its result');
    });

    it('requires a predicate to name the function that answers it', () => {
        const predicate = { verb: 'is', name: 'plotted', on: 'element', changes: 'constant', reads: 'fresh' };

        expect(messageOf(() => new DomqlModule('charts', { predicates: [predicate] }))).toContain('function that answers it');
        expect(messageOf(() => new DomqlModule('charts', { predicates: [{ ...predicate, function: 'isPlotted' }] }, {}))).toContain("'isPlotted'");
    });

    it('carries a member that selects a member out through what its name resolves to', () => {
        const selecting = selects => declaration({ name: 'charts', parameters: [parameter({ fixed: true, selects })] });

        expect(() => new DomqlModule('charts', { members: [{ ...selecting('member'), function: undefined }] })).not.toThrow();
        expect(messageOf(() => new DomqlModule('charts', { members: [selecting('member')] }))).toContain('no function');
        expect(() => new DomqlModule('charts', { members: [selecting('feature')] })).not.toThrow();
    });

    it('refuses a member that selects a predicate, which only a test reads', () => {
        const selecting = declaration({ name: 'charts', parameters: [parameter({ fixed: true, selects: 'predicate' })] });

        expect(messageOf(() => new DomqlModule('charts', { members: [selecting] }))).toContain('declares what it selects');
    });

describe('observations', () => {
        const attributes = { type: 'mutation', of: 'receiver', attributes: true };
        const observed = overrides => declaration({ name: 'charts', changes: 'observable', observations: [attributes], ...overrides });
        const fails = contents => messageOf(() => new DomqlModule('charts', contents));

        it('are named by a member that changes observably or partly observably, and by no other', () => {
            expect(() => new DomqlModule('charts', { members: [observed()] })).not.toThrow();
            expect(() => new DomqlModule('charts', { members: [observed({ changes: 'partly-observable', misses: 'transforms' })] })).not.toThrow();
            expect(fails({ members: [observed({ observations: [] })] })).toContain('names the observations that cover its changes');
            expect(fails({ members: [declaration({ name: 'charts', changes: 'constant', observations: [attributes] })] })).toContain('names no observations');
            expect(fails({ members: [declaration({ name: 'charts', changes: 'derived', observations: [attributes] })] })).toContain('names no observations');
        });

        it('observe the receiver, the window, the document or an argument of the member', () => {
            const parameters = [parameter({ name: 'other', type: 'element' })];

            expect(() => new DomqlModule('charts', { members: [observed({ parameters, observations: [{ type: 'resize', of: { argument: 'other' } }] })] })).not.toThrow();
            expect(() => new DomqlModule('charts', { members: [observed({ observations: [{ type: 'event', of: 'window', types: ['focus'] }, { type: 'visibility', of: 'document' }] })] })).not.toThrow();
            expect(fails({ members: [observed({ observations: [{ type: 'resize', of: 'parent' }] })] })).toContain('observes the receiver, the window, the document or an argument');
            expect(fails({ members: [observed({ observations: [{ type: 'resize', of: { argument: 'missing' } }] })] })).toContain('observes the receiver, the window, the document or an argument');
            expect(fails({ members: [observed({ observations: [{ type: 'resize' }] })] })).toContain('observes the receiver');
        });

        it('give their arguments literals, lists of literals and arguments of the member', () => {
            const parameters = [parameter({ name: 'name', type: 'string' })];

            expect(() => new DomqlModule('charts', { members: [observed({ parameters, observations: [{ type: 'mutation', of: 'receiver', attributes: [{ argument: 'name' }, 'type'], subtree: false, depth: 2 }] })] })).not.toThrow();
            expect(fails({ members: [observed({ observations: [{ type: 'mutation', of: 'receiver', attributes: { anything: 1 } }] })] })).toContain('no literal, list of literals or argument of the member');
            expect(fails({ members: [observed({ observations: [{ type: 'mutation', of: 'receiver', attributes: [{ argument: 'missing' }] }] })] })).toContain('no literal, list of literals or argument of the member');
        });

        it('are named for a type that is a name', () => {
            expect(fails({ members: [observed({ observations: [{ type: 'Not a name', of: 'receiver' }] })] })).toContain('names its type as a name is');
            expect(fails({ members: [observed({ observations: 'resize' })] })).toContain('observations are a list');
        });

        it('are named by predicates in the same way, with no arguments to refer to', () => {
            const predicate = { verb: 'is', name: 'plotted', function: 'isPlotted', on: 'element', changes: 'observable', reads: 'fresh' };

            expect(() => new DomqlModule('charts', { predicates: [{ ...predicate, observations: [attributes] }] })).not.toThrow();
            expect(fails({ predicates: [predicate] })).toContain('names the observations that cover its changes');
            expect(fails({ predicates: [{ ...predicate, observations: [{ type: 'resize', of: { argument: 'other' } }] }] })).toContain('observes the receiver');
        });
    });

    describe('observation types', () => {
        const type = overrides => ({ name: 'ticks', contract: 'invalidation', function: 'startTicks', ...overrides });
        const fails = (observationType, functions) => messageOf(() => new DomqlModule('charts', { observationTypes: [observationType] }, functions));

        it('are kept as data, with the arguments of their identity and whether they are shared', () => {
            const module = new DomqlModule('charts', { observationTypes: [type(), type({ name: 'sampled', contract: 'maintained', identity: ['root'], shared: false, function: 'startSampled' })] }, { startTicks: () => ({}), startSampled: () => ({}) });

            expect(module.observationTypes.map(declared => [declared.name, declared.identity, declared.shared])).toEqual([['ticks', [], true], ['sampled', ['root'], false]]);
            expect(Object.isFrozen(module.observationTypes[0])).toBe(true);
        });

        it('are named, have a contract and name the function that starts them', () => {
            expect(fails(type({ name: 'Not a name' }))).toContain('observation type is named as a name is');
            expect(fails(type({ contract: 'sometimes' }))).toContain('is one of invalidation, maintained');
            expect(fails(type({ function: undefined }))).toContain('function that starts it');
            expect(fails(type({ identity: 'root' }))).toContain('identity');
            expect(fails(type({ shared: 'yes' }))).toContain('whether observations are shared');
        });

        it('need the function they name among the functions of the module', () => {
            expect(fails(type(), {})).toContain("'startTicks'");
        });
    });
});
