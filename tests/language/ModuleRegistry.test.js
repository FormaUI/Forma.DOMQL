import { describe, it, expect } from 'vitest';
import { DomqlModule } from '#domql/language/DomqlModule.mjs';
import { ModuleRegistry } from '#domql/language/ModuleRegistry.mjs';
import { Vocabulary } from '#domql/language/Vocabulary.mjs';
import { declaration, messageOf } from './declarations.mjs';

describe('ModuleRegistry', () => {
    const own = () => new DomqlModule('charts', {
        types: [{ name: 'chart', fields: { points: 'number' } }],
        members: [declaration({ name: 'points', on: 'chart' }), declaration({ name: 'charts', on: 'element' })],
    });

    it('registers the built-in module and a module beside it', () => {
        expect(new ModuleRegistry([Vocabulary.module, own()]).modules).toEqual(['built-in', 'charts']);
    });

    it('refuses a module registered twice', () => {
        expect(messageOf(() => new ModuleRegistry([own(), own()]))).toContain('name is taken');
    });

    it('refuses a member outside the module own types unless it is named for the module', () => {
        const module = new DomqlModule('charts', { members: [declaration({ name: 'other' })] });

        expect(messageOf(() => new ModuleRegistry([module]))).toContain("named for the module, 'charts'");
    });

    it('refuses a member the registry already answers on the same receiver', () => {
        const module = new DomqlModule('charts', { members: [declaration({ name: 'charts', on: 'element' }), declaration({ name: 'charts', on: 'element' })] });

        expect(messageOf(() => new ModuleRegistry([module]))).toContain('declared already');
        expect(messageOf(() => new ModuleRegistry([Vocabulary.module, new DomqlModule('size', { members: [declaration({ name: 'size', on: 'element' })] })]))).toContain('declared already');
    });

    it('lets one name answer on different receivers', () => {
        const owners = new ModuleRegistry([Vocabulary.module]).getMembers('size').map(member => member.on);

        expect(owners).toEqual(['window', 'element']);
    });

    it('refuses an event, a predicate or a type declared twice', () => {
        const events = new DomqlModule('twice', { eventTypes: [{ name: 'click', payload: 'domEvent' }] });

        expect(messageOf(() => new ModuleRegistry([Vocabulary.module, events]))).toContain("'click' is declared already");
    });

describe('observation types', () => {
        const types = [{ name: 'ticks', contract: 'invalidation', function: 'startTicks' }, { name: 'sampled', contract: 'maintained', function: 'startSampled' }];
        const functions = { startTicks: () => ({}), startSampled: () => ({}), zoom: () => 1 };
        const watching = (overrides, moduleTypes = types) => new DomqlModule('charts', { observationTypes: moduleTypes, members: [declaration({ name: 'charts', changes: 'observable', observations: [{ type: 'ticks', of: 'receiver' }], ...overrides })] }, functions);

        it('are declared by a module, which its members and the members of later modules use', () => {
            const later = new DomqlModule('later', { members: [declaration({ name: 'later', changes: 'observable', observations: [{ type: 'ticks', of: 'receiver' }] })] });

            expect(() => new ModuleRegistry([watching({}), later])).not.toThrow();
            expect(new ModuleRegistry([watching({})]).getObservationType('ticks')).toMatchObject({ name: 'ticks', contract: 'invalidation', shared: true });
        });

        it('are declared once', () => {
            expect(messageOf(() => new ModuleRegistry([watching({}), new DomqlModule('again', { observationTypes: [types[0]] }, functions)]))).toContain("observation type 'ticks' is declared already");
        });

        it('are declared by some module for every observation a member names', () => {
            expect(messageOf(() => new ModuleRegistry([watching({ observations: [{ type: 'unknown', of: 'receiver' }] })]))).toContain("observation type 'unknown' is declared by no module");
        });

        it('give a member that reads maintained values a maintained observation, and give no other member one', () => {
            expect(() => new ModuleRegistry([watching({ reads: 'maintained', observations: [{ type: 'sampled', of: 'receiver' }] })])).not.toThrow();
            expect(messageOf(() => new ModuleRegistry([watching({ reads: 'maintained' })]))).toContain('names a maintained observation');
            expect(messageOf(() => new ModuleRegistry([watching({ observations: [{ type: 'sampled', of: 'receiver' }] })]))).toContain('reads maintained values');
        });

        it('start with the function their module supplies', () => {
            const registry = new ModuleRegistry([watching({})]);

            expect(registry.getFunction(registry.getObservationType('ticks'))).toBe(functions.startTicks);
        });
    });
});
