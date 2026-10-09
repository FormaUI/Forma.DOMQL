import { beforeEach, describe, it, expect } from 'vitest';
import { Observations } from '#domql/dom/Observations.mjs';
import { DomqlError } from '#domql/language/DomqlError.mjs';
import { DomqlModule } from '#domql/language/vocabulary/DomqlModule.mjs';
import { ModuleRegistry } from '#domql/language/vocabulary/ModuleRegistry.mjs';
import { Vocabulary } from '#domql/language/vocabulary/Vocabulary.mjs';

/** A module of observation types that start nothing in a browser, and the record of what they did. */
const createObservationTypes = () => {
    const record = { started: [], stopped: [], notifiers: [], samples: [] };
    const start = name => (request, notify) => {
        const index = record.started.length;

        record.started.push({ name, request });
        record.notifiers.push(notify);

        return {
            stop: () => record.stopped.push(index),
            sample: () => record.samples[index] ?? { pending: true, value: null },
        };
    };
    const module = new DomqlModule('fake', {
        observationTypes: [
            { name: 'ticks', contract: 'invalidation', identity: ['step'], function: 'startTicks' },
            { name: 'sampled', contract: 'maintained', function: 'startSampled' },
            { name: 'solo', contract: 'invalidation', shared: false, function: 'startSolo' },
            { name: 'broken', contract: 'invalidation', function: 'startBroken' },
            { name: 'mute', contract: 'invalidation', function: 'startMute' },
        ],
    }, {
        startTicks: start('ticks'),
        startSampled: start('sampled'),
        startSolo: start('solo'),
        startBroken: () => { throw new Error('no clock'); },
        startMute: () => ({}),
    });

    return { module, record };
};

describe('Observations', () => {
    let record;
    let observations;
    let reported;
    let target;

    beforeEach(() => {
        const fake = createObservationTypes();

        record = fake.record;
        reported = [];
        target = document.createElement('div');
        observations = new Observations(new ModuleRegistry([Vocabulary.module, fake.module]), { window, document }, { reportError: error => reported.push(error) });
    });

    const request = (type, args = {}, on = target) => ({ type, target: on, arguments: args });

    describe('sessions', () => {
        it('start an observation once for equivalent requests, and end it when the last session is disposed', () => {
            const first = observations.acquire(request('ticks', { step: 1 }), () => {});
            const second = observations.acquire(request('ticks', { step: 1 }), () => {});

            expect(record.started).toHaveLength(1);
            expect(observations.running).toBe(1);

            first.dispose();

            expect(record.stopped).toEqual([]);

            second.dispose();

            expect(record.stopped).toEqual([0]);
            expect(observations.running).toBe(0);
        });

        it('start another observation after the last one ended', () => {
            observations.acquire(request('ticks', { step: 1 }), () => {}).dispose();
            observations.acquire(request('ticks', { step: 1 }), () => {});

            expect(record.started).toHaveLength(2);
        });

        it('share only requests that agree on the arguments that belong to the identity', () => {
            observations.acquire(request('ticks', { step: 1 }), () => {});
            observations.acquire(request('ticks', { step: 2 }), () => {});
            observations.acquire(request('ticks', { step: 1, unrelated: 'x' }), () => {});

            expect(record.started).toHaveLength(2);
        });

        it('tell objects in an identity apart, and equal lists together', () => {
            const one = document.createElement('i');
            const other = document.createElement('i');

            observations.acquire(request('ticks', { step: [one, 1] }), () => {});
            observations.acquire(request('ticks', { step: [one, 1] }), () => {});
            observations.acquire(request('ticks', { step: [other, 1] }), () => {});

            expect(record.started).toHaveLength(2);
        });

        it('do not share between targets or between kinds', () => {
            observations.acquire(request('ticks'), () => {});
            observations.acquire(request('ticks', {}, document.createElement('div')), () => {});
            observations.acquire(request('sampled'), () => {});

            expect(record.started.map(started => started.name)).toEqual(['ticks', 'ticks', 'sampled']);
        });

        it('do not share a kind that is not shared', () => {
            const first = observations.acquire(request('solo'), () => {});

            observations.acquire(request('solo'), () => {});
            first.dispose();

            expect(record.started).toHaveLength(2);
            expect(record.stopped).toEqual([0]);
        });

        it('are disposed once, however often they are told to', () => {
            const session = observations.acquire(request('ticks'), () => {});

            session.dispose();
            session.dispose();

            expect(session.isDisposed).toBe(true);
            expect(record.stopped).toEqual([0]);
        });

        it('report a failure to stop and are still disposed', () => {
            const broken = new Observations(new ModuleRegistry([Vocabulary.module, new DomqlModule('stuck', {
                observationTypes: [{ name: 'stuck', contract: 'invalidation', function: 'startStuck' }],
            }, { startStuck: () => ({ stop: () => { throw new Error('stuck'); } }) })]), { window, document }, { reportError: error => reported.push(error) });

            broken.acquire(request('stuck'), () => {}).dispose();

            expect(reported.map(error => error.message)).toEqual(['stuck']);
            expect(broken.running).toBe(0);
        });
    });

    describe('changes', () => {
        it('reach every session of the observation, and none that is disposed', () => {
            const calls = [];
            const first = observations.acquire(request('ticks'), () => calls.push('first'));

            observations.acquire(request('ticks'), () => calls.push('second'));
            first.dispose();
            record.notifiers[0]();

            expect(calls).toEqual(['second']);
        });

        it('reach the other sessions when one fails, and are reported', () => {
            const calls = [];

            observations.acquire(request('ticks'), () => { throw new Error('first fails'); });
            observations.acquire(request('ticks'), () => calls.push('second'));
            record.notifiers[0]();

            expect(calls).toEqual(['second']);
            expect(reported.map(error => error.message)).toEqual(['first fails']);
        });

        it('reach the other sessions when reporting a failure fails too', () => {
            const calls = [];
            const types = createObservationTypes();
            const observing = new Observations(new ModuleRegistry([Vocabulary.module, types.module]), { window, document }, { reportError: () => { throw new Error('nowhere to report'); } });

            observing.acquire(request('ticks'), () => { throw new Error('first fails'); });
            observing.acquire(request('ticks'), () => calls.push('second'));

            expect(() => types.record.notifiers[0]()).not.toThrow();
            expect(calls).toEqual(['second']);
        });

        it('are disposed when the observation fails to stop and reporting the failure fails too', () => {
            const stuck = new Observations(new ModuleRegistry([Vocabulary.module, new DomqlModule('stuck', {
                observationTypes: [{ name: 'stuck', contract: 'invalidation', function: 'startStuck' }],
            }, { startStuck: () => ({ stop: () => { throw new Error('stuck'); } }) })]), { window, document }, { reportError: () => { throw new Error('nowhere to report'); } });

            expect(() => stuck.acquire(request('stuck'), () => {}).dispose()).not.toThrow();
            expect(stuck.running).toBe(0);
        });

        it('reach a session that is disposed while they are delivered no more', () => {
            const calls = [];
            const session = observations.acquire(request('ticks'), () => {
                calls.push('first');
                session.dispose();
            });

            observations.acquire(request('ticks'), () => calls.push('second'));
            record.notifiers[0]();
            record.notifiers[0]();

            expect(calls).toEqual(['first', 'second', 'second']);
        });
    });

    describe('samples', () => {
        it('are pending until the first arrives, and the latest after', () => {
            const session = observations.acquire(request('sampled'), () => {});

            expect(session.contract).toBe('maintained');
            expect(session.sample()).toEqual({ pending: true, value: null });

            record.samples[0] = { pending: false, value: true };

            expect(session.sample()).toEqual({ pending: false, value: true });
        });

        it('are shared by the sessions of one observation', () => {
            const first = observations.acquire(request('sampled'), () => {});
            const second = observations.acquire(request('sampled'), () => {});

            record.samples[0] = { pending: false, value: false };

            expect(first.sample()).toEqual(second.sample());
        });

        it('are refused to a disposed session', () => {
            const session = observations.acquire(request('sampled'), () => {});

            session.dispose();

            expect(() => session.sample()).toThrow(TypeError);
        });

        it('belong to a maintained observation alone', () => {
            expect(() => observations.acquire(request('ticks'), () => {}).sample()).toThrow(TypeError);
        });
    });

    describe('failures', () => {
        const failure = action => {
            try {
                action();
            } catch (error) {
                expect(error).toBeInstanceOf(DomqlError);
                expect(error.kind).toBe('evaluation');

                return error;
            }

            throw new Error('The action succeeded');
        };

        it('leave nothing running when an observation fails to start, and start again at the next request', () => {
            const error = failure(() => observations.acquire(request('broken'), () => {}));

            expect(error.message).toContain('no clock');
            expect(error.cause).toBeInstanceOf(Error);
            expect(observations.running).toBe(0);
            expect(() => observations.acquire(request('ticks'), () => {})).not.toThrow();
        });

        it('refuse an observation type that starts one it cannot stop', () => {
            expect(failure(() => observations.acquire(request('mute'), () => {})).message).toContain('no stop');
            expect(observations.running).toBe(0);
        });

        it('refuse a kind no module declares', () => {
            expect(failure(() => observations.acquire(request('nothing'), () => {})).message).toContain('declared by no module');
        });

        it('refuse a kind whose module supplies no function', () => {
            const empty = new ModuleRegistry([new DomqlModule('empty', { observationTypes: [{ name: 'empty', contract: 'invalidation', function: 'startEmpty' }] })]);

            expect(failure(() => new Observations(empty, { window, document }).acquire(request('empty'), () => {})).message).toContain("supplies no function for the observation type 'empty'");
        });
    });

    describe('requests', () => {
        const call = { receiver: null, args: {} };

        it('name the receiver, the window, the document or an argument as the target', () => {
            const other = document.createElement('i');

            expect(observations.resolve({ type: 'ticks', of: 'receiver' }, { receiver: target, args: {} }).target).toBe(target);
            expect(observations.resolve({ type: 'ticks', of: 'window' }, call).target).toBe(window);
            expect(observations.resolve({ type: 'ticks', of: 'document' }, call).target).toBe(document);
            expect(observations.resolve({ type: 'ticks', of: { argument: 'other' } }, { receiver: target, args: { other } }).target).toBe(other);
        });

        it('replace each argument an observation names with its value, in lists too', () => {
            const resolved = observations.resolve({ type: 'ticks', of: 'receiver', step: { argument: 'name' }, names: [{ argument: 'name' }, 'fixed'], flag: true }, { receiver: target, args: { name: 'id' } });

            expect(resolved).toEqual({ type: 'ticks', target, arguments: { step: 'id', names: ['id', 'fixed'], flag: true } });
        });

        it('refuse a value that is neither a literal nor an argument', () => {
            expect(() => observations.resolve({ type: 'ticks', of: 'receiver', step: { not: 'an argument' } }, { receiver: target, args: {} })).toThrow(TypeError);
        });

        it('observe nothing where the target is an argument that is null', () => {
            const resolved = observations.resolve({ type: 'ticks', of: { argument: 'other' } }, { receiver: target, args: { other: null } });

            expect(resolved).toBeNull();
            expect(observations.acquire(resolved, () => {}).isDisposed).toBe(false);
            expect(record.started).toEqual([]);
        });

        it('resolve the observations a built-in member names', () => {
            const [declaration] = new ModuleRegistry([Vocabulary.module]).getMembers('attribute-of');
            const requests = declaration.observations.map(observation => observations.resolve(observation, { receiver: target, args: { name: 'id' } }));

            expect(requests).toEqual([{ type: 'mutation', target, arguments: { attributes: ['id'] } }]);
        });
    });

    describe('disposal', () => {
        it('ends every observation and disposes every session', () => {
            const sessions = [observations.acquire(request('ticks'), () => {}), observations.acquire(request('sampled'), () => {}), observations.acquire(request('solo'), () => {})];

            observations.dispose();

            expect(sessions.every(session => session.isDisposed)).toBe(true);
            expect(observations.running).toBe(0);
            expect(record.stopped.sort()).toEqual([0, 1, 2]);
        });
    });
});
