import { describe, it, expect } from 'vitest';
import { DomqlModule } from '#domql/language/DomqlModule.mjs';
import { Registry } from '#domql/language/Registry.mjs';
import { Vocabulary } from '#domql/language/Vocabulary.mjs';
import { declaration, messageOf } from './declarations.mjs';

describe('Registry', () => {
    const own = () => new DomqlModule('charts', {
        types: [{ name: 'chart', fields: { points: 'number' } }],
        declarations: [declaration({ name: 'points', on: 'chart' }), declaration({ name: 'charts', on: 'element' })],
    });

    it('registers the core and a module beside it', () => {
        expect(new Registry([Vocabulary.module, own()]).modules).toEqual(['core', 'charts']);
    });

    it('refuses a module registered twice', () => {
        expect(messageOf(() => new Registry([own(), own()]))).toContain('name is taken');
    });

    it('refuses a member outside the module own types unless it is named for the module', () => {
        const module = new DomqlModule('charts', { declarations: [declaration({ name: 'other' })] });

        expect(messageOf(() => new Registry([module]))).toContain("named for the module, 'charts'");
    });

    it('refuses a member the registry already answers on the same receiver', () => {
        const module = new DomqlModule('charts', { declarations: [declaration({ name: 'charts', on: 'element' }), declaration({ name: 'charts', on: 'element' })] });

        expect(messageOf(() => new Registry([module]))).toContain('declared already');
        expect(messageOf(() => new Registry([Vocabulary.module, new DomqlModule('size', { declarations: [declaration({ name: 'size', on: 'element' })] })]))).toContain('declared already');
    });

    it('lets one name answer on different receivers', () => {
        const owners = new Registry([Vocabulary.module]).getMembers('size').map(member => member.on);

        expect(owners).toEqual(['window', 'element']);
    });

    it('refuses an event, a predicate or a type declared twice', () => {
        const events = new DomqlModule('twice', { events: [{ name: 'click', payload: 'domEvent' }] });

        expect(messageOf(() => new Registry([Vocabulary.module, events]))).toContain("'click' is declared already");
    });
});
