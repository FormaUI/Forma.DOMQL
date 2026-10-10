import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

/** The error a call throws. */
const getError = call => {
    try {
        call();
    } catch (error) {
        return error;
    }

    throw new Error('The call threw nothing');
};

describe('Behavior', () => {
    // Each test loads its own copy of Domql, with a registry of its own.
    let isolated;
    let panel;
    let other;
    let calls;
    let reported;
    let breaks;

    /** A behavior module: its one member, named for it, on an element, taking a color. */
    const behavior = (name, activate) => isolated.createModule(name, {
        members: [{
            name, function: name, kind: 'behavior', on: 'element', result: 'null', changes: 'unobserved', reads: 'fresh',
            parameters: [{ name: 'color', kind: 'value', type: 'string', required: true, nulls: 'propagate' }],
        }],
    }, { [name]: activate });

    beforeEach(async () => {
        vi.resetModules();
        ({ Domql: isolated } = await import('#domql/domql.js'));
        document.body.innerHTML = '<div id="panel"></div><div id="other"></div>';
        panel = document.getElementById('panel');
        other = document.getElementById('other');
        calls = [];
        reported = [];
        breaks = new Set();
        window.reportError = error => reported.push(error);

        // Marks its element with the color while it is in effect.
        isolated.registerModule(behavior('highlight', (element, { color }, environment, context) => {
            calls.push({ call: 'activate', element, color, environment, context });
            element.dataset.highlight = color;

            let current = element;

            return {
                update: (next, { color: nextColor }) => {
                    calls.push({ call: 'update', element: next, color: nextColor });

                    if (breaks.has('update')) {
                        throw new Error('stuck');
                    }

                    delete current.dataset.highlight;
                    current = next;
                    current.dataset.highlight = nextColor;
                },
                dispose: () => {
                    calls.push({ call: 'dispose', element: current });
                    delete current.dataset.highlight;

                    if (breaks.has('dispose')) {
                        throw new Error('held');
                    }
                },
            };
        }));
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    describe('activating', () => {
        it('puts the behavior into effect in the call, with its receiver, arguments, environment and reporter', () => {
            const highlight = isolated.activate('@panel.highlight(@color)', { panel, color: 'gold' });

            expect(highlight.status).toBe('ready');
            expect(panel.dataset.highlight).toBe('gold');
            expect(calls).toEqual([{ call: 'activate', element: panel, color: 'gold', environment: { window, document }, context: { reportError: expect.any(Function) } }]);
        });

        it('takes a behavior request, as text or as a request', () => {
            isolated.activate(isolated.parse('@panel.highlight("teal")', { panel }));

            expect(panel.dataset.highlight).toBe('teal');
        });

        it('lets the behavior report a failure while it runs to the window\'s error reporting', () => {
            isolated.activate('@panel.highlight("gold")', { panel });
            calls[0].context.reportError(new Error('flicker'));

            expect(reported.map(error => error.message)).toEqual(['flicker']);
        });

        it('activates nothing where its receiver is null, until an update supplies one', () => {
            const highlight = isolated.activate('@item.highlight("gold")', { item: isolated.bind(null, 'element?') });

            expect(calls).toEqual([]);

            highlight.update({ item: panel });

            expect(panel.dataset.highlight).toBe('gold');
            expect(calls.map(call => call.call)).toEqual(['activate']);

            highlight.update({ item: isolated.bind(null, 'element?') });

            expect(panel.dataset.highlight).toBeUndefined();
            expect(calls.map(call => call.call)).toEqual(['activate', 'dispose']);
        });

        it('fails the call where the behavior cannot activate, or answers no way to update and dispose it, leaving nothing running', () => {
            let disposed = 0;

            isolated.registerModule(behavior('broken', () => { throw new Error('closed'); }));
            isolated.registerModule(behavior('partial', () => ({ dispose: () => disposed++ })));

            const thrown = getError(() => isolated.activate('@panel.broken("gold")', { panel }));

            expect(thrown).toMatchObject({ kind: 'evaluation', message: expect.stringContaining("The behavior 'broken' failed to activate") });
            expect(thrown.cause.message).toBe('closed');
            expect(getError(() => isolated.activate('@panel.partial("gold")', { panel }))).toMatchObject({ kind: 'evaluation', message: expect.stringContaining('answered no update and dispose') });
            expect(disposed).toBe(1);
        });

        it('is refused for a request of another kind, and a behavior request is refused by the other calls', () => {
            expect(getError(() => isolated.activate('@panel.children.count', { panel }))).toMatchObject({ kind: 'validation', message: expect.stringContaining('A query request is not activated') });
            expect(getError(() => isolated.read('@panel.highlight("gold")', { panel }))).toMatchObject({ kind: 'validation', message: expect.stringContaining('A behavior request is not read') });
            expect(calls).toEqual([]);
        });
    });

    describe('updating', () => {
        it('replaces the bindings whole, handing the behavior its new receiver and arguments', () => {
            const highlight = isolated.activate('@target.highlight(@color)', { target: panel, color: 'gold' });

            highlight.update({ target: other, color: 'teal' });

            expect(panel.dataset.highlight).toBeUndefined();
            expect(other.dataset.highlight).toBe('teal');
            expect(calls.at(-1)).toEqual({ call: 'update', element: other, color: 'teal' });
        });

        it('validates the bindings before anything changes, leaving the behavior as it was', () => {
            const highlight = isolated.activate('@target.highlight(@color)', { target: panel, color: 'gold' });

            expect(getError(() => highlight.update({ target: other }))).toMatchObject({ kind: 'validation', message: expect.stringContaining("The parameter '@color' is not bound") });
            expect(getError(() => highlight.update({ target: other, color: 7 }))).toMatchObject({ kind: 'validation' });
            expect(getError(() => highlight.update(null))).toMatchObject({ kind: 'structure' });
            expect(panel.dataset.highlight).toBe('gold');
            expect(calls.map(call => call.call)).toEqual(['activate']);
        });

        it('throws a failure of the behavior\'s own update, which keeps what it last accepted', () => {
            const highlight = isolated.activate('@target.highlight(@color)', { target: panel, color: 'gold' });

            breaks.add('update');

            const error = getError(() => highlight.update({ target: other, color: 'teal' }));

            expect(error).toMatchObject({ kind: 'evaluation', message: expect.stringContaining("The behavior 'highlight' failed to update") });
            expect(error.cause.message).toBe('stuck');
            expect(panel.dataset.highlight).toBe('gold');
            expect(highlight.status).toBe('ready');
        });

        it('updates the same behavior after another module was registered', () => {
            const highlight = isolated.activate('@panel.highlight(@color)', { panel, color: 'gold' });

            isolated.registerModule(behavior('glow', () => ({ update: () => {}, dispose: () => {} })));
            highlight.update({ panel, color: 'teal' });

            expect(panel.dataset.highlight).toBe('teal');
        });

        it('throws once the behavior is disposed', () => {
            const highlight = isolated.activate('@panel.highlight("gold")', { panel });

            highlight.dispose();

            expect(getError(() => highlight.update({ panel }))).toMatchObject({ kind: 'evaluation', message: 'A disposed behavior cannot be updated' });
        });
    });

    describe('disposing', () => {
        it('ends the behavior once, however often it is disposed', () => {
            const highlight = isolated.activate('@panel.highlight("gold")', { panel });

            highlight.dispose();
            highlight.dispose();

            expect(highlight.status).toBe('disposed');
            expect(panel.dataset.highlight).toBeUndefined();
            expect(calls.map(call => call.call)).toEqual(['activate', 'dispose']);
        });

        it('reports a failure of the behavior\'s own dispose, and ends the behavior all the same', () => {
            const highlight = isolated.activate('@panel.highlight("gold")', { panel });

            breaks.add('dispose');
            highlight.dispose();

            expect(highlight.status).toBe('disposed');
            expect(reported.map(error => error.message)).toEqual(['held']);
        });

        it('leaves the behavior\'s module registered, so it activates again', () => {
            isolated.activate('@panel.highlight("gold")', { panel }).dispose();
            isolated.activate('@panel.highlight("teal")', { panel });

            expect(panel.dataset.highlight).toBe('teal');
        });
    });
});
