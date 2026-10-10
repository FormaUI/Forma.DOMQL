import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

/** Lets the observations deliver and the watches that follow them evaluate. */
const settle = (milliseconds = 0) => new Promise(resolve => setTimeout(resolve, milliseconds));

/** The error a promise rejects with. */
const rejection = promise => promise.then(() => { throw new Error('The promise resolved'); }, error => error);

describe('Watch', () => {
    // Each test loads its own copy of Domql, with a registry of its own.
    let isolated;
    let panel;
    let snapshots;
    let failures;
    let reported;
    let watches;
    let gauges;
    let evaluations;
    let broken;

    beforeEach(async () => {
        vi.resetModules();
        ({ Domql: isolated } = await import('#domql/domql.js'));
        document.body.innerHTML = '<div id="panel" data-n="1"><i data-n="1"></i><i data-n="2"></i></div>';
        panel = document.getElementById('panel');
        snapshots = [];
        failures = [];
        reported = [];
        watches = [];
        gauges = new Map();
        evaluations = 0;
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
                const gauge = { sample: { pending: true, value: null }, stopped: 0, notify };

                gauges.set(target, gauge);

                return { stop: () => gauge.stopped++, sample: () => gauge.sample };
            },
            level: (_receiver, _args, _environment, [sample]) => sample,
        }));

        // A member that counts the evaluations that read it, and one that fails while the test says so, both changing with the attributes of their element.
        const attributes = [{ type: 'mutation', of: 'receiver', attributes: true }];

        isolated.registerModule(isolated.createModule('tally', {
            members: [{ name: 'tally', function: 'tally', kind: 'property', on: 'element', parameters: [], result: 'number', changes: 'observable', reads: 'fresh', observations: attributes }],
        }, { tally: () => ++evaluations }));
        isolated.registerModule(isolated.createModule('flaky', {
            members: [{ name: 'flaky', function: 'flaky', kind: 'property', on: 'element', parameters: [], result: 'number', changes: 'observable', reads: 'fresh', observations: attributes }],
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
        watches.forEach(watch => watch.dispose());
        document.body.innerHTML = '';
    });

    const watch = (text, bindings = {}, options = {}) => {
        const created = isolated.watch(isolated.parse(text, bindings), {
            onChange: snapshot => snapshots.push(snapshot),
            onError: error => failures.push(error),
            schedule: 'immediate',
            ...options,
        });

        watches.push(created);

        return created;
    };

    /** Takes the animation frames from the window, so a test runs them when it chooses. */
    const holdFrames = () => {
        const frames = { callbacks: [], canceled: [] };

        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => frames.callbacks.push(callback));
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(handle => frames.canceled.push(handle));

        return frames;
    };

    const change = (element, value) => {
        element.setAttribute('data-n', String(value));

        return settle();
    };

    describe('the first snapshot', () => {
        it('is reported after the call returns, as the baseline through the callback every snapshot uses', async () => {
            const watched = watch('@panel.attributeOf("data-n")', { panel });

            expect(watched.status).toBe('pending');
            expect(snapshots).toEqual([]);

            await settle();

            expect(watched.status).toBe('ready');
            expect(snapshots).toEqual(['1']);
            expect(watched.lastSnapshot).toBe('1');
        });

        it('waits for the first sample of every maintained member it reads', async () => {
            const [first] = panel.children;
            const watched = watch('{ n: @item.level }', { item: first });

            await settle();

            expect(watched.status).toBe('pending');
            expect(snapshots).toEqual([]);

            gauges.get(first).sample = { pending: false, value: 4 };
            gauges.get(first).notify();
            await settle();

            expect(watched.status).toBe('ready');
            expect(snapshots).toEqual([{ n: 4 }]);
        });

        it('reports a null snapshot, which is read beside the status', async () => {
            const watched = watch('@panel.first(".none").attributeOf("data-n")', { panel }, { acceptPartialObservation: true });

            await settle();

            expect(snapshots).toEqual([null]);
            expect(watched.status).toBe('ready');
            expect(watched.lastSnapshot).toBeNull();
        });
    });

    describe('changes', () => {
        it('are followed by an evaluation, which reports an snapshot that differs', async () => {
            watch('@panel.attributeOf("data-n")', { panel });
            await settle();
            await change(panel, 5);

            expect(snapshots).toEqual(['1', '5']);
        });

        it('report nothing when the snapshot is the one last reported', async () => {
            watch('@panel.attributeOf("data-n")', { panel });
            await settle();
            await change(panel, 1);

            expect(snapshots).toEqual(['1']);
        });

        it('are delivered as snapshots that share what did not change', async () => {
            watch('@panel { id: attributeOf "id", items: children { n: attributeOf "data-n" } }', { panel });
            await settle();
            await change(panel.children[1], 7);

            const [before, after] = snapshots;

            expect(after.items[1]).toEqual({ n: '7' });
            expect(after).not.toBe(before);
            expect(after.items).not.toBe(before.items);
            expect(after.items[0]).toBe(before.items[0]);
            expect(Object.isFrozen(after)).toBe(true);
        });

        it('are followed through the elements the query now reads: one added is observed, one removed is not', async () => {
            watch('@panel.children { n: attributeOf "data-n" }', { panel });
            await settle();

            const added = document.createElement('i');

            added.setAttribute('data-n', '3');
            panel.append(added);
            await settle();

            expect(snapshots.at(-1)).toEqual([{ n: '1' }, { n: '2' }, { n: '3' }]);

            await change(added, 9);

            expect(snapshots.at(-1)).toEqual([{ n: '1' }, { n: '2' }, { n: '9' }]);

            added.remove();
            await settle();

            const reports = snapshots.length;

            await change(added, 10);

            expect(snapshots.length).toBe(reports);
        });

        it('wait for the next animation frame when the watch is scheduled so, evaluating once however many fired', async () => {
            const frames = holdFrames();

            watch('@panel.tally', { panel }, { schedule: 'frame' });
            await settle();

            expect(snapshots).toEqual([1]);

            panel.setAttribute('data-n', '2');
            panel.setAttribute('data-n', '3');
            panel.setAttribute('data-n', '4');
            await settle();

            expect(snapshots).toEqual([1]);
            expect(frames.callbacks.length).toBe(1);

            frames.callbacks[0]();

            expect(snapshots).toEqual([1, 2]);
            expect(evaluations).toBe(2);
        });

        it('are followed in the task that reported them when the watch is scheduled so', async () => {
            watch('@panel.tally', { panel }, { schedule: 'immediate' });
            await settle();

            panel.setAttribute('data-n', '2');
            await settle();

            expect(snapshots).toEqual([1, 2]);
        });
    });

    describe('a maintained member it first reads after its first snapshot', () => {
        it('is pending in the snapshot reported, which is evaluated again when its first sample arrives', async () => {
            const [first, second] = panel.children;

            watch('{ a: @first.level }', { first });
            await settle();
            gauges.get(first).sample = { pending: false, value: 1 };
            gauges.get(first).notify();
            await settle();

            expect(snapshots).toEqual([{ a: 1 }]);

            // A watch of the list reads the second child's gauge once it has been added to what is read.
            const listed = watch('@panel.children { level }', { panel });

            await settle();
            gauges.get(first).notify();
            await settle();

            expect(listed.status).toBe('pending');

            gauges.get(second).sample = { pending: false, value: 2 };
            gauges.get(second).notify();
            gauges.get(first).sample = { pending: false, value: 1 };
            gauges.get(first).notify();
            await settle();

            expect(snapshots.at(-1)).toEqual([{ level: 1 }, { level: 2 }]);
        });
    });

    describe('an evaluation that fails', () => {
        it('is reported, keeps the watch running and its last snapshot, and its recovery reports the snapshot whether or not it differs', async () => {
            const watched = watch('{ n: @panel.flaky }', { panel });

            await settle();
            broken = true;
            await change(panel, 2);

            expect(watched.status).toBe('failed');
            expect(failures.length).toBe(1);
            expect(failures[0].name).toBe('DomqlError');
            expect(failures[0].message).toContain("The member 'flaky' failed");
            expect(watched.lastSnapshot).toEqual({ n: 1 });

            broken = false;
            await change(panel, 1);

            expect(watched.status).toBe('ready');
            expect(snapshots).toEqual([{ n: 1 }, { n: 1 }]);
        });

        it('keeps the dependencies of its last success together with those the failure recorded', async () => {
            const watched = watch('{ n: @panel.flaky }', { panel });

            await settle();
            broken = true;
            await change(panel, 2);
            await change(panel, 3);
            await change(panel, 4);

            expect(watched.status).toBe('failed');
            expect(failures.length).toBe(3);

            broken = false;
            await change(panel, 5);

            expect(snapshots.at(-1)).toEqual({ n: 5 });
        });
    });

    describe('a callback that fails', () => {
        it('is reported to the failure callback and leaves the watch running with the state it was handed accepted', async () => {
            let fails = true;
            const watched = watch('@panel.attributeOf("data-n")', { panel }, {
                onChange: snapshot => {
                    snapshots.push(snapshot);

                    if (fails) {
                        throw new Error('consumer');
                    }
                },
            });

            await settle();

            expect(failures.map(error => error.message)).toEqual(['consumer']);
            expect(watched.status).toBe('ready');

            fails = false;
            await change(panel, 2);

            expect(snapshots).toEqual(['1', '2']);
        });

        it('is reported when it rejects, and is not waited for', async () => {
            const watched = watch('@panel.attributeOf("data-n")', { panel }, { onChange: () => Promise.reject(new Error('later')) });

            await settle();

            expect(failures.map(error => error.message)).toEqual(['later']);
            expect(watched.status).toBe('ready');
        });

        it('goes to the diagnostic reporting where there is no failure callback', async () => {
            watch('@panel.attributeOf("data-n")', { panel }, { onChange: () => { throw new Error('consumer'); }, onError: undefined });
            await settle();

            expect(reported.map(error => error.message)).toEqual(['consumer']);
        });

        it('sends the failure of the failure callback to the diagnostic reporting, calling nothing again', async () => {
            watch('@panel.attributeOf("data-n")', { panel }, {
                onChange: () => { throw new Error('consumer'); },
                onError: error => {
                    failures.push(error);

                    return Promise.reject(new Error('failure callback'));
                },
            });
            await settle();

            expect(failures.length).toBe(1);
            expect(reported.map(error => error.message)).toEqual(['failure callback']);
        });

        it('lets the callbacks of other watches run when one fails', async () => {
            const others = [];

            watch('@panel.attributeOf("data-n")', { panel }, { onChange: () => { throw new Error('first'); } });
            watch('@panel.attributeOf("data-n")', { panel }, { onChange: snapshot => others.push(snapshot) });
            await settle();

            expect(others).toEqual(['1']);
        });
    });

    describe('refreshAsync', () => {
        it('evaluates now and settles once the snapshot has been handed to the callback', async () => {
            const watched = watch('@panel.tally', { panel }, { schedule: 'frame' });

            await settle();
            await watched.refreshAsync();

            expect(snapshots).toEqual([1, 2]);
        });

        it('evaluates once when it comes before the first evaluation, which it snapshots', async () => {
            const watched = watch('@panel.tally', { panel });
            const refreshing = watched.refreshAsync();

            await refreshing;
            await settle();

            expect(snapshots).toEqual([1]);
            expect(evaluations).toBe(1);
        });

        it('settles without delivering where the snapshot did not change', async () => {
            const watched = watch('@panel.attributeOf("data-n")', { panel });

            await settle();
            await watched.refreshAsync();

            expect(snapshots).toEqual(['1']);
        });

        it('does not wait for a promise the callback returns, so a callback can await a refresh', async () => {
            let nested;
            const watched = watch('@panel.tally', { panel }, {
                onChange: async snapshot => {
                    snapshots.push(snapshot);

                    if (snapshot === 1) {
                        nested = watched.refreshAsync();
                        await nested;
                    }
                },
            });

            await settle();
            await nested;

            expect(snapshots).toEqual([1, 2]);
        });

        it('rejects with the failure of its evaluation, which is reported as well', async () => {
            const watched = watch('{ n: @panel.flaky }', { panel });

            await settle();
            broken = true;

            const error = await rejection(watched.refreshAsync());

            expect(error.message).toContain("The member 'flaky' failed");
            expect(failures).toEqual([error]);
        });

        it('settles without delivering where disposal cancels it', async () => {
            const [first] = panel.children;
            const watched = watch('{ n: @item.level }', { item: first });

            await settle();

            const refreshing = watched.refreshAsync();

            watched.dispose();

            await expect(refreshing).resolves.toBeUndefined();
            expect(snapshots).toEqual([]);
        });

        it('rejects when called after disposal', async () => {
            const watched = watch('@panel.attributeOf("data-n")', { panel });

            watched.dispose();

            expect((await rejection(watched.refreshAsync())).message).toContain('disposed');
        });
    });

    describe('dispose', () => {
        it('ends the watch: it reports nothing more and lets go of every observation', async () => {
            const [first] = panel.children;
            const watched = watch('{ n: @item.level, id: @panel.attributeOf("data-n") }', { item: first, panel });

            await settle();
            gauges.get(first).sample = { pending: false, value: 1 };
            gauges.get(first).notify();
            await settle();

            watched.dispose();

            expect(watched.status).toBe('disposed');
            expect(gauges.get(first).stopped).toBe(1);

            await change(panel, 9);
            gauges.get(first).notify();
            await settle();

            expect(snapshots).toEqual([{ n: 1, id: '1' }]);
        });

        it('cancels the evaluation it scheduled', async () => {
            const frames = holdFrames();
            const watched = watch('@panel.tally', { panel }, { schedule: 'frame' });

            await settle();
            panel.setAttribute('data-n', '2');
            await settle();
            watched.dispose();

            expect(frames.canceled).toEqual([1]);

            frames.callbacks[0]();

            expect(snapshots).toEqual([1]);
        });

        it('prevents the first snapshot when it comes before it', async () => {
            const watched = watch('@panel.attributeOf("data-n")', { panel });

            watched.dispose();
            await settle();

            expect(snapshots).toEqual([]);
        });

        it('does nothing when it is repeated', async () => {
            const watched = watch('@panel.attributeOf("data-n")', { panel });

            await settle();
            watched.dispose();
            watched.dispose();

            expect(watched.status).toBe('disposed');
        });

        it('lets a callback already running finish, and starts none after', async () => {
            let finished = false;
            const watched = watch('@panel.attributeOf("data-n")', { panel }, {
                onChange: async snapshot => {
                    snapshots.push(snapshot);
                    watched.dispose();
                    await settle();
                    finished = true;
                },
            });

            await settle(5);
            await change(panel, 3);

            expect(finished).toBe(true);
            expect(snapshots).toEqual(['1']);
        });
    });

    describe('a query that is watched', () => {
        it('is refused when a member only partly observes its changes, unless the watch accepts that', () => {
            const query = isolated.parse('@panel.rect', { panel });
            const error = (() => {
                try {
                    isolated.watch(query, { onChange: () => {} });
                } catch (failure) {
                    return failure;
                }

                throw new Error('The watch was created');
            })();

            expect(error.name).toBe('DomqlError');
            expect(error.kind).toBe('validation');
            expect(error.message).toContain('rect');

            watches.push(isolated.watch(query, { onChange: () => {}, acceptPartialObservation: true }));
        });

        it('takes the function that receives its snapshots, a schedule and a delivery that exist', () => {
            const query = isolated.parse('@panel.attributeOf("id")', { panel });

            for (const options of [{}, { onChange: 3 }, { onChange: () => {}, onError: 3 }, { onChange: () => {}, schedule: 'later' }, { onChange: () => {}, delivery: 'patch' }]) {
                expect(() => isolated.watch(query, options)).toThrow(expect.objectContaining({ name: 'DomqlError', kind: 'structure' }));
            }
        });

        it('is a query: a request that is not one is refused when the watch is made', () => {
            const subscription = isolated.parse('@panel.eventsOf("click") { ratio: @window.devicePixelRatio }', { panel });

            expect(isolated.resolve(subscription, { watch: true }).kind).toBe('subscription');
            expect(() => isolated.watch(subscription, { onChange: () => {} })).toThrow(expect.objectContaining({ name: 'DomqlError', kind: 'evaluation', message: expect.stringContaining('subscription request is not watched') }));
        });

        it('is scheduled by animation frame only in a window that has them', () => {
            const query = isolated.parse('@panel.attributeOf("id")', { panel });
            const frameless = { document, reportError: () => {} };

            expect(() => isolated.watch(query, { onChange: () => {}, window: frameless })).toThrow(expect.objectContaining({ kind: 'structure' }));
            watches.push(isolated.watch(query, { onChange: () => {}, window: frameless, schedule: 'immediate' }));
        });

        it('needs a browser window', () => {
            expect(() => isolated.watch(isolated.parse('@window.devicePixelRatio'), { onChange: () => {}, window: null })).toThrow(expect.objectContaining({ kind: 'evaluation' }));
        });
    });
});
