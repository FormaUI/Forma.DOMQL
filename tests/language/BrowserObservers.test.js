import { describe, it, expect } from 'vitest';
import { ModuleRegistry } from '#domql/language/ModuleRegistry.mjs';
import { Observations } from '#domql/language/Observations.mjs';
import { Vocabulary } from '#domql/language/Vocabulary.mjs';

/** A window whose pixel ratio and media queries the test controls, since a browser's cannot be changed from inside it. */
const createWindow = devicePixelRatio => {
    const lists = [];
    const fake = {
        devicePixelRatio,
        lists,
        matchMedia: query => {
            // The listeners by what the page registered, each wrapped to leave once it has run where it asked for that.
            const listeners = new Map();
            const list = {
                query,
                addEventListener: (_type, listener, options) => listeners.set(listener, options?.once ? () => { listeners.delete(listener); listener(); } : listener),
                removeEventListener: (_type, listener) => listeners.delete(listener),
                fire: () => [...listeners.values()].forEach(run => run()),
                get listeners() { return listeners.size; },
            };

            lists.push(list);

            return list;
        },
    };

    return fake;
};

describe('BrowserObservers', () => {
    describe('pixel-ratio', () => {
        const watch = fake => {
            const observations = new Observations(new ModuleRegistry([Vocabulary.module]), { window: fake, document });
            const changes = [];
            const session = observations.acquire(observations.resolve({ type: 'pixel-ratio', of: 'window' }, { receiver: fake, args: {} }), () => changes.push(fake.devicePixelRatio));

            return { observations, changes, session };
        };

        it('listens for the ratio it has now to be left', () => {
            const fake = createWindow(2);

            watch(fake);

            expect(fake.lists.map(list => list.query)).toEqual(['(resolution: 2dppx)']);
        });

        it('reports the ratio changing, and listens for the new ratio to be left', () => {
            const fake = createWindow(1);
            const { changes } = watch(fake);

            fake.devicePixelRatio = 2;
            fake.lists[0].fire();

            expect(changes).toEqual([2]);
            expect(fake.lists.map(list => list.query)).toEqual(['(resolution: 1dppx)', '(resolution: 2dppx)']);
            expect(fake.lists[0].listeners).toBe(0);

            fake.devicePixelRatio = 3;
            fake.lists[1].fire();

            expect(changes).toEqual([2, 3]);
        });

        it('stops listening when its last holder lets go', () => {
            const fake = createWindow(1);
            const { session, observations } = watch(fake);

            session.dispose();

            expect(fake.lists[0].listeners).toBe(0);
            expect(observations.running).toBe(0);
        });

        it('stops listening for the new ratio too, after it changed', () => {
            const fake = createWindow(1);
            const { session } = watch(fake);

            fake.devicePixelRatio = 2;
            fake.lists[0].fire();
            session.dispose();

            expect(fake.lists[1].listeners).toBe(0);
        });
    });
});
