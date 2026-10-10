import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

/** Lets a promise a callback returned settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('EventListener', () => {
    // Each test loads its own copy of Domql, with a registry of its own.
    let isolated;
    let panel;
    let results;
    let failures;
    let reported;
    let listeners;
    let gauges;
    let stuck;
    let broken;

    beforeEach(async () => {
        vi.resetModules();
        ({ Domql: isolated } = await import('#domql/domql.js'));
        document.body.innerHTML = '<div id="panel" data-n="1"><i id="a" data-n="1"></i><i id="b" data-n="2"></i></div>';
        panel = document.getElementById('panel');
        results = [];
        failures = [];
        reported = [];
        listeners = [];
        gauges = new Map();
        stuck = new Set();
        broken = false;
        window.reportError = error => reported.push(error);

        // A member kept by an observation whose samples the test supplies, one gauge for each element.
        isolated.registerModule(isolated.createModule('level', {
            observationTypes: [{ name: 'level', contract: 'maintained', function: 'observeLevel' }],
            members: [{
                name: 'level', function: 'level', kind: 'property', on: 'element', parameters: [], result: 'number?',
                changes: 'observable', reads: 'maintained', observations: [{ type: 'level', of: 'receiver' }],
            }],
        }, {
            observeLevel: ({ target }, notify) => {
                const gauge = { sample: { pending: true, value: null }, started: (gauges.get(target)?.started ?? 0) + 1, stopped: gauges.get(target)?.stopped ?? 0, notify };

                gauges.set(target, gauge);

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

        // A member that fails while the test says so.
        isolated.registerModule(isolated.createModule('flaky', {
            members: [{ name: 'flaky', function: 'flaky', kind: 'property', on: 'element', parameters: [], result: 'number', changes: 'constant', reads: 'fresh' }],
        }, {
            flaky: element => {
                if (broken) {
                    throw new Error('broken');
                }

                return Number(element.getAttribute('data-n'));
            },
        }));
    });

    afterEach(() => {
        listeners.forEach(listener => listener.dispose());
        document.body.innerHTML = '';
    });

    const subscribe = (text, bindings = {}, options = {}) => {
        const created = isolated.subscribe(isolated.parse(text, bindings), {
            onEvent: result => results.push(result),
            onError: error => failures.push(error),
            ...options,
        });

        listeners.push(created);

        return created;
    };

    /** Registers a module whose source `beats` the function starts, delivering occurrences that carry a number. */
    const registerBeats = start => isolated.registerModule(isolated.createModule('beats', {
        types: [{ name: 'beat', fields: { n: 'number' } }],
        eventTypes: [{ name: 'beat', payload: 'beat' }],
        members: [{ name: 'beats', function: 'beats', kind: 'source', on: 'element', parameters: [{ name: 'type', kind: 'value', type: 'string', required: true, fixed: true, selects: 'occurrence', nulls: 'propagate' }], result: 'occurrence<@selected>', changes: 'constant', reads: 'captured' }],
    }, { beats: start }));

    /** Dispatches an input event at the element, which bubbles to the panel. */
    const input = element => element.dispatchEvent(new window.Event('input', { bubbles: true }));

    describe('subscribing', () => {
        it('starts in the call, so an occurrence that follows it is heard in the task it is dispatched in', () => {
            const listener = subscribe('@panel.eventsOf("input") { id: target.attributeOf("id") }', { panel });

            expect(listener.status).toBe('ready');

            input(panel.children[0]);
            input(panel);

            expect(results).toEqual([{ id: 'a' }, { id: 'panel' }]);
            expect(Object.isFrozen(results[0])).toBe(true);
        });

        it('hears the occurrences that reach its receiver alone', () => {
            subscribe('@first.eventsOf("input") { id: target.attributeOf("id") }', { first: panel.children[0] });

            input(panel.children[1]);
            input(panel.children[0]);

            expect(results).toEqual([{ id: 'a' }]);
        });

        it('captures what the event carries when it is dispatched', () => {
            subscribe('@panel.eventsOf("click") { button, x: clientX, kind: pointerType }', { panel });

            panel.dispatchEvent(new window.PointerEvent('click', { bubbles: true, button: 2, clientX: 12, pointerType: 'pen' }));

            expect(results).toEqual([{ button: 2, x: 12, kind: 'pen' }]);
        });

        it('takes a subscription given as its text', () => {
            listeners.push(isolated.subscribe('@panel.eventsOf("input") { id: target.attributeOf("id") }', { panel }, { onEvent: result => results.push(result) }));

            input(panel);

            expect(results).toEqual([{ id: 'panel' }]);
        });

        it('starts the source with its receiver and arguments, and stops it when disposed', () => {
            const calls = [];
            let deliver;
            let stopped = 0;

            registerBeats((receiver, args, environment, delivers) => {
                calls.push({ receiver, args, environment });
                deliver = delivers;

                return { stop: () => stopped++ };
            });

            const listener = subscribe('@panel.beats("beat") { n }', { panel });

            deliver({ n: 5 });
            listener.dispose();
            deliver({ n: 6 });

            expect(calls).toEqual([{ receiver: panel, args: { type: 'beat' }, environment: { window, document } }]);
            expect(results).toEqual([{ n: 5 }]);
            expect(stopped).toBe(1);
        });

        it('projects what the source delivers while it starts at once, and hands it over once the caller has the event listener, before what follows', async () => {
            const [first] = panel.children;
            let deliver;

            registerBeats((_receiver, _args, _environment, delivers) => {
                deliver = delivers;
                delivers({ n: 1 });
                delivers({ n: 'one' });

                return { stop: () => {} };
            });

            subscribe('@panel.beats("beat") { n, level: @item.level }', { panel, item: first });

            expect(results).toEqual([]);
            expect(failures).toEqual([]);
            expect(gauges.get(first)).toMatchObject({ started: 1, stopped: 0 });

            deliver({ n: 2 });
            await Promise.resolve();

            expect(results).toEqual([{ n: 1, level: null }, { n: 2, level: null }]);
            expect(failures).toHaveLength(1);

            deliver({ n: 3 });

            expect(results).toHaveLength(3);
        });

        it('fails the call where the source cannot start, or answers nothing that stops it', () => {
            registerBeats(element => {
                if (element.id === 'a') {
                    throw new Error('closed');
                }

                return {};
            });

            const [first, second] = panel.children;

            expect(() => subscribe('@item.beats("beat") { n }', { item: first })).toThrow(expect.objectContaining({ kind: 'evaluation', message: expect.stringContaining("The source 'beats' failed to start listening"), cause: expect.objectContaining({ message: 'closed' }) }));
            expect(() => subscribe('@item.beats("beat") { n }', { item: second })).toThrow(expect.objectContaining({ kind: 'evaluation', message: expect.stringContaining('answered nothing that stops it') }));
        });

        it('fails the call with what the source threw as its cause, even where that is no error', () => {
            registerBeats(() => {
                throw null;
            });

            let error;

            try {
                subscribe('@panel.beats("beat") { n }', { panel });
            } catch (failure) {
                error = failure;
            }

            expect(error).toMatchObject({ kind: 'evaluation', message: expect.stringContaining("The source 'beats' failed to start listening") });
            expect(error.cause).toBeNull();
        });

        it('lets go of what an occurrence delivered while the source started opened, and hands nothing over, where the start then fails', async () => {
            const [first] = panel.children;

            registerBeats((_receiver, _args, _environment, deliver) => {
                deliver({ n: 1 });

                throw new Error('closed');
            });

            expect(() => subscribe('@panel.beats("beat") { n, level: @item.level }', { panel, item: first })).toThrow(expect.objectContaining({ kind: 'evaluation' }));
            await Promise.resolve();

            expect(results).toEqual([]);
            expect(gauges.get(first)).toMatchObject({ started: 1, stopped: 1 });
        });

        it('listens to nothing where the receiver of its source is null', () => {
            const listener = subscribe('@panel.first(".none").eventsOf("input") { id: target.attributeOf("id") }', { panel });

            input(panel);

            expect(listener.status).toBe('ready');
            expect(results).toEqual([]);
        });

        it('refuses a request that is not a subscription, and options it cannot use', () => {
            const subscription = isolated.parse('@panel.eventsOf("input") { id: target.attributeOf("id") }', { panel });

            expect(() => isolated.subscribe(isolated.parse('@panel.children.count', { panel }), { onEvent: () => {} })).toThrow(expect.objectContaining({ kind: 'evaluation', message: expect.stringContaining('A query request is not listened to') }));
            expect(() => isolated.subscribe(subscription, {})).toThrow(expect.objectContaining({ kind: 'structure' }));
            expect(() => isolated.subscribe(subscription, { onEvent: () => {}, onError: 'loudly' })).toThrow(expect.objectContaining({ kind: 'structure' }));
        });
    });

    describe('sessions', () => {
        it('answer null for a maintained member still pending, and the sample that arrived for a later occurrence', () => {
            const [first] = panel.children;

            subscribe('@panel.eventsOf("input") { level: target.level }', { panel });

            input(first);
            gauges.get(first).sample = { pending: false, value: 4 };
            input(first);

            expect(results).toEqual([{ level: null }, { level: 4 }]);
            expect(gauges.get(first)).toMatchObject({ started: 1, stopped: 0 });
        });

        it('keep what the last projection read and let go of the rest', () => {
            const [first, second] = panel.children;

            subscribe('@panel.eventsOf("input") { level: target.level }', { panel });

            input(first);
            input(second);

            expect(gauges.get(first)).toMatchObject({ started: 1, stopped: 1 });
            expect(gauges.get(second)).toMatchObject({ started: 1, stopped: 0 });
        });

        it('are kept as they were through a projection that fails, which lets go of those it opened and delivers nothing', () => {
            const [first, second] = panel.children;
            const listener = subscribe('@panel.eventsOf("input") { level: target.level, n: target.flaky }', { panel });

            input(first);
            broken = true;
            input(second);

            expect(results).toEqual([{ level: null, n: 1 }]);
            expect(failures).toHaveLength(1);
            expect(failures[0].message).toContain("The member 'flaky' failed");
            expect(listener.status).toBe('ready');
            expect(gauges.get(first)).toMatchObject({ started: 1, stopped: 0 });
            expect(gauges.get(second)).toMatchObject({ started: 1, stopped: 1 });

            broken = false;
            input(first);

            expect(results).toHaveLength(2);
        });
    });

    describe('capture', () => {
        it('reports an occurrence the source cannot capture to the error callback, and keeps listening', () => {
            let deliver;

            registerBeats((_receiver, _args, _environment, delivers) => {
                deliver = delivers;

                return { stop: () => {} };
            });

            const listener = subscribe('@panel.beats("beat") { n }', { panel });

            deliver({ n: 'one' });
            deliver({ n: 2 });

            expect(failures).toHaveLength(1);
            expect(failures[0].message).toContain("The source 'beats' delivered an occurrence whose 'n' is \"one\", and its type declares number");
            expect(results).toEqual([{ n: 2 }]);
            expect(listener.status).toBe('ready');
        });
    });

    describe('callbacks', () => {
        it('report a callback that throws or rejects to the error callback, and keep listening', async () => {
            let calls = 0;

            subscribe('@panel.eventsOf("input") { id: target.attributeOf("id") }', { panel }, {
                onEvent: () => {
                    calls++;

                    if (calls === 1) {
                        throw new Error('thrown');
                    }

                    return Promise.reject(new Error('rejected'));
                },
            });

            input(panel);
            input(panel);
            await settle();

            expect(calls).toBe(2);
            expect(failures.map(failure => failure.message)).toEqual(['thrown', 'rejected']);
        });

        it('send a failure of the error callback, and a failure where there is none, to the window\'s error reporting', () => {
            subscribe('@panel.eventsOf("input") { n: target.flaky }', { panel }, { onError: () => { throw new Error('unheard'); } });
            listeners.push(isolated.subscribe('@panel.eventsOf("input") { n: target.flaky }', { panel }, { onEvent: () => {} }));

            broken = true;
            input(panel);

            expect(reported.map(failure => failure.message)).toEqual(['unheard', expect.stringContaining("The member 'flaky' failed")]);
        });
    });

    describe('disposal', () => {
        it('lets go of every session even where an observation fails to stop, and reports the failure', () => {
            const [first, second] = panel.children;
            const listener = subscribe('@panel.eventsOf("input") { a: @first.level, b: @second.level }', { panel, first, second });

            stuck.add(first);
            input(panel);
            listener.dispose();

            expect(listener.status).toBe('disposed');
            expect(gauges.get(first)).toMatchObject({ started: 1, stopped: 1 });
            expect(gauges.get(second)).toMatchObject({ started: 1, stopped: 1 });
            expect(reported.map(failure => failure.message)).toEqual(['stuck']);
        });

        it('stops listening, lets go of every session and calls nothing again', () => {
            const [first] = panel.children;
            const listener = subscribe('@panel.eventsOf("input") { level: target.level }', { panel });

            input(first);
            listener.dispose();
            input(first);

            expect(listener.status).toBe('disposed');
            expect(results).toEqual([{ level: null }]);
            expect(gauges.get(first)).toMatchObject({ started: 1, stopped: 1 });
            expect(() => listener.dispose()).not.toThrow();
        });

        it('reports a source that fails to stop, and ends the event listener all the same', () => {
            registerBeats(() => ({ stop: () => { throw new Error('stuck'); } }));

            const listener = subscribe('@panel.beats("beat") { n }', { panel });

            listener.dispose();

            expect(listener.status).toBe('disposed');
            expect(reported.map(failure => failure.message)).toEqual(['stuck']);
        });
    });
});
