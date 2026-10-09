import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { BrowserModule } from '#domql/dom/BrowserModule.mjs';
import { Observations } from '#domql/dom/Observations.mjs';
import { ModuleRegistry } from '#domql/language/vocabulary/ModuleRegistry.mjs';
import { Vocabulary } from '#domql/language/vocabulary/Vocabulary.mjs';

/** The observation types of the built-in vocabulary, started in the browser they observe. */
describe('Observations in a browser', () => {
    let observations;
    let registry;
    let sessions;

    beforeEach(() => {
        document.body.style.margin = '0';
        registry = new ModuleRegistry([BrowserModule.create()]);
        observations = new Observations(registry, { window, document });
        sessions = [];
    });

    afterEach(() => {
        observations.dispose();
        document.body.innerHTML = '';
    });

    const add = (style, parent = document.body) => {
        const element = document.createElement('div');

        element.style.cssText = style;
        parent.append(element);

        return element;
    };

    /** Observes as a call to a member would, and answers the session and a promise of the next change. */
    const watch = (observation, receiver, args = {}) => {
        let changed;
        const next = () => new Promise(resolve => { changed = resolve; });
        const session = observations.acquire(observations.resolve(observation, { receiver, args }), () => changed?.());

        sessions.push(session);

        return { session, next };
    };

    /** Lets observers deliver what they were told, which they do before the next frame. */
    const settled = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    /** Whether something happens: a change a watch reports. A probe on the same target reports first, so a later silence is the watch's own. */
    const reports = async (watching, cause) => {
        let reported = false;

        watching.next().then(() => { reported = true; });
        cause();
        await settled();

        return reported;
    };

    describe('resize', () => {
        it('reports a change of size of an element, and not the observation starting', async () => {
            const box = add('width: 100px; height: 20px');
            const watching = watch({ type: 'resize', of: 'receiver' }, box);

            expect(await reports(watching, () => {})).toBe(false);
            expect(await reports(watching, () => { box.style.width = '150px'; })).toBe(true);
            expect(await reports(watching, () => { box.style.color = 'red'; })).toBe(false);
        });

        it('reports the window being resized', async () => {
            const watching = watch({ type: 'resize', of: 'window' }, null);

            expect(await reports(watching, () => window.dispatchEvent(new Event('resize')))).toBe(true);
        });

        it('reports an element named by an argument, and nothing for one that is null', async () => {
            const other = add('width: 10px; height: 10px');
            const observation = { type: 'resize', of: { argument: 'other' } };
            const watching = watch(observation, null, { other });

            await settled();

            expect(await reports(watching, () => { other.style.height = '40px'; })).toBe(true);
            expect(observations.resolve(observation, { receiver: null, args: { other: null } })).toBeNull();
        });
    });

    describe('mutation', () => {
        it('reports the attributes it is told to filter on, and no other', async () => {
            const box = add('');
            const watching = watch({ type: 'mutation', of: 'receiver', attributes: ['disabled'] }, box);

            expect(await reports(watching, () => box.setAttribute('title', 'x'))).toBe(false);
            expect(await reports(watching, () => box.setAttribute('disabled', ''))).toBe(true);
        });

        it('reports an attribute named by an argument', async () => {
            const box = add('');
            const watching = watch({ type: 'mutation', of: 'receiver', attributes: [{ argument: 'name' }] }, box, { name: 'data-key' });

            expect(await reports(watching, () => box.setAttribute('id', 'x'))).toBe(false);
            expect(await reports(watching, () => box.setAttribute('data-key', 'a'))).toBe(true);
        });

        it('reports the children of a node, and its descendants only where it is told to', async () => {
            const parent = add('');
            const child = add('', parent);
            const children = watch({ type: 'mutation', of: 'receiver', childList: true }, parent);
            const subtree = watch({ type: 'mutation', of: 'receiver', childList: true, subtree: true }, parent);

            expect(await reports(children, () => child.append(document.createElement('i')))).toBe(false);
            expect(await reports(subtree, () => child.append(document.createElement('i')))).toBe(true);
            expect(await reports(children, () => parent.append(document.createElement('i')))).toBe(true);
        });

        it('observes nothing when it is told to observe nothing', () => {
            expect(() => observations.acquire(observations.resolve({ type: 'mutation', of: 'receiver' }, { receiver: add(''), args: {} }), () => {})).toThrow(/attributes, children or text/);
        });
    });

    describe('attachment', () => {
        it('reports an element leaving and returning to the document', async () => {
            const box = add('');
            const watching = watch({ type: 'attachment', of: 'receiver' }, box);

            expect(await reports(watching, () => box.remove())).toBe(true);
            expect(await reports(watching, () => document.body.append(box))).toBe(true);
            expect(await reports(watching, () => { box.style.width = '5px'; })).toBe(false);
        });

        it('reports an element that is moved between parents while it stays attached as no change', async () => {
            const first = add('');
            const second = add('');
            const box = add('', first);
            const watching = watch({ type: 'attachment', of: 'receiver' }, box);

            expect(await reports(watching, () => second.append(box))).toBe(false);
        });

        it('reports a detached element being attached', async () => {
            const box = document.createElement('div');
            const watching = watch({ type: 'attachment', of: 'receiver' }, box);

            expect(await reports(watching, () => document.body.append(box))).toBe(true);
        });

        it('follows an element whose detached tree is rooted at an element that has a host of its own', async () => {
            const anchor = document.createElement('a');
            const inner = document.createElement('div');

            anchor.append(inner);

            const watching = watch({ type: 'attachment', of: 'receiver' }, inner);

            expect(await reports(watching, () => document.body.append(anchor))).toBe(true);
        });

        it('follows an element through the shadow roots between it and the document', async () => {
            const host = add('');
            const shadow = host.attachShadow({ mode: 'open' });
            const inner = document.createElement('div');

            shadow.append(inner);

            const watching = watch({ type: 'attachment', of: 'receiver' }, inner);

            expect(await reports(watching, () => host.remove())).toBe(true);
            expect(await reports(watching, () => document.body.append(host))).toBe(true);
            expect(await reports(watching, () => inner.remove())).toBe(true);
        });
    });

    describe('intersection', () => {
        it('is pending until the browser reports, and then the latest report', async () => {
            const box = add('position: absolute; left: 0; top: 0; width: 50px; height: 50px');
            const watching = watch({ type: 'intersection', of: 'receiver', root: null, margin: 0 }, box);

            expect(watching.session.contract).toBe('maintained');
            expect(watching.session.sample()).toEqual({ pending: true, value: null });

            await watching.next();

            expect(watching.session.sample()).toEqual({ pending: false, value: true });
        });

        it('reports an element leaving the root it is observed against', async () => {
            const root = add('position: absolute; left: 0; top: 0; width: 100px; height: 100px; overflow: hidden');
            const box = add('position: absolute; left: 10px; top: 10px; width: 20px; height: 20px', root);
            const watching = watch({ type: 'intersection', of: 'receiver', root: { argument: 'root' }, margin: 0 }, box, { root });

            await watching.next();

            expect(watching.session.sample().value).toBe(true);

            const left = watching.next();

            box.style.left = '300px';
            await left;

            expect(watching.session.sample()).toEqual({ pending: false, value: false });
        });

        it('grows the root by the margin', async () => {
            const root = add('position: absolute; left: 0; top: 0; width: 100px; height: 100px');
            const box = add('position: absolute; left: 130px; top: 10px; width: 20px; height: 20px', root);
            const without = watch({ type: 'intersection', of: 'receiver', root: { argument: 'root' }, margin: 0 }, box, { root });
            const grown = watch({ type: 'intersection', of: 'receiver', root: { argument: 'root' }, margin: 50 }, box, { root });

            await Promise.all([without.next(), grown.next()]);

            expect(without.session.sample().value).toBe(false);
            expect(grown.session.sample().value).toBe(true);
        });
    });

    describe('media', () => {
        it('reports a media query beginning and ceasing to match', async () => {
            const width = document.documentElement.clientWidth;
            const watching = watch({ type: 'media', of: 'window', query: `(min-width: ${width}px)` }, null);
            const frame = window.frameElement;
            const before = frame.style.width;

            try {
                expect(await reports(watching, () => { frame.style.width = `${width - 100}px`; })).toBe(true);
            } finally {
                frame.style.width = before;
            }
        });
    });

    describe('pixel ratio', () => {
        it('starts and ends without reporting a change that has not happened', async () => {
            const watching = watch({ type: 'pixel-ratio', of: 'window' }, null);

            expect(await reports(watching, () => {})).toBe(false);
            watching.session.dispose();
            expect(observations.running).toBe(0);
        });
    });

    describe('event', () => {
        it('reports events of the types it is told to listen to', async () => {
            const box = add('');
            const watching = watch({ type: 'event', of: 'receiver', types: ['input', 'select'] }, box);

            expect(await reports(watching, () => box.dispatchEvent(new Event('click')))).toBe(false);
            expect(await reports(watching, () => box.dispatchEvent(new Event('input')))).toBe(true);
            expect(await reports(watching, () => box.dispatchEvent(new Event('select')))).toBe(true);
        });

        it('reports an event in the capture phase that a descendant would not bubble', async () => {
            const parent = add('');
            const child = add('', parent);
            const bubbling = watch({ type: 'event', of: 'receiver', types: ['scroll'] }, parent);
            const capturing = watch({ type: 'event', of: 'receiver', types: ['scroll'], capture: true }, parent);

            expect(await reports(bubbling, () => child.dispatchEvent(new Event('scroll')))).toBe(false);
            expect(await reports(capturing, () => child.dispatchEvent(new Event('scroll')))).toBe(true);
        });

        it('reports the focus moving, by the events that bubble', async () => {
            document.body.innerHTML = '<input id="first"><input id="second">';

            const watching = watch({ type: 'event', of: 'document', types: ['focusin', 'focusout'] }, null);

            expect(await reports(watching, () => document.getElementById('first').focus())).toBe(true);
            expect(await reports(watching, () => document.getElementById('second').focus())).toBe(true);
        });

        it('stops listening when the last holder lets go', async () => {
            const box = add('');
            const watching = watch({ type: 'event', of: 'receiver', types: ['input'] }, box);

            watching.session.dispose();

            expect(await reports(watching, () => box.dispatchEvent(new Event('input')))).toBe(false);
        });
    });

    describe('visibility', () => {
        it('reports the document becoming visible or hidden', async () => {
            const watching = watch({ type: 'visibility', of: 'document' }, document);

            expect(await reports(watching, () => document.dispatchEvent(new Event('visibilitychange')))).toBe(true);
        });
    });

    describe('the built-in vocabulary', () => {
        /** A value for a parameter: its default, or one of the type it takes. */
        const argumentFor = (parameter, other) => {
            if ('default' in parameter) {
                return parameter.default;
            }

            return { string: 'x', number: 1, element: other }[parameter.type] ?? 'x';
        };

        it('starts and ends every observation it names, against a real receiver', async () => {
            const element = add('width: 40px; height: 40px');
            const other = add('width: 10px; height: 10px');
            const declarations = [...Vocabulary.module.members, ...Vocabulary.module.predicates].filter(declaration => declaration.observations.length > 0);

            expect(declarations.length).toBeGreaterThan(15);

            for (const declaration of declarations) {
                const first = [declaration.on].flat()[0];
                const receiver = first === 'window' ? window : first === 'document' ? document : element;
                const args = Object.fromEntries((declaration.parameters ?? []).map(parameter => [parameter.name, argumentFor(parameter, other)]));

                for (const observation of declaration.observations) {
                    const session = observations.acquire(observations.resolve(observation, { receiver, args }), () => {});

                    sessions.push(session);
                    expect(session.isDisposed, `${declaration.name} ${observation.type}`).toBe(false);
                }
            }

            await settled();
            sessions.forEach(session => session.dispose());

            expect(observations.running).toBe(0);
        });
    });
});
