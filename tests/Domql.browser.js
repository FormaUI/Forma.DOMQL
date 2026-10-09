import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { Domql } from '#domql/domql.js';

/** The reads that wait for a browser's observations, which only a real browser delivers. */
describe('Domql readAsync in a browser', () => {
    let panel;
    let inside;
    let outside;

    beforeEach(() => {
        document.body.style.margin = '0';
        document.body.innerHTML = `
            <div id="panel" style="position: relative; width: 200px; height: 100px; overflow: auto">
                <div id="inside" style="height: 40px"></div>
                <div id="outside" style="height: 40px; margin-top: 400px"></div>
            </div>`;
        panel = document.getElementById('panel');
        inside = document.getElementById('inside');
        outside = document.getElementById('outside');
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('reads whether an element intersects the viewport, once the browser has reported it', async () => {
        expect(await Domql.readAsync(Domql.parse('@item.intersects', { item: inside }))).toBe(true);
        expect(await Domql.readAsync(Domql.parse('@item.intersects', { item: outside }))).toBe(false);
    });

    it('reads whether an element intersects a root, with the margin that widens it', async () => {
        expect(await Domql.readAsync(Domql.parse('@item.intersects(root: @panel)', { item: outside, panel }))).toBe(false);
        expect(await Domql.readAsync(Domql.parse('@item.intersects(root: @panel, margin: 500)', { item: outside, panel }))).toBe(true);
    });

    it('reads it among the other members of a shape', async () => {
        const answer = await Domql.readAsync(Domql.parse('@item { near: intersects, height: size.height, id: attribute-of "id" }', { item: inside }));

        expect(answer).toEqual({ near: true, height: 40, id: 'inside' });
    });

    it('is refused by read, which cannot wait for the sample', () => {
        expect(() => Domql.read(Domql.parse('@item.intersects', { item: inside }))).toThrow("The member 'intersects' is maintained by an observation");
    });

    it('is canceled by a signal before the browser reports', async () => {
        const controller = new AbortController();
        const reading = Domql.readAsync(Domql.parse('@item.intersects', { item: inside }), { signal: controller.signal }).catch(error => error);

        controller.abort(new Error('not needed'));

        expect((await reading).message).toBe('not needed');
    });
});
