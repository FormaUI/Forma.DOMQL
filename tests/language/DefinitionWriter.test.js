import { describe, it, expect } from 'vitest';
import { Domql } from '#domql/domql.js';
import { DefinitionWriter } from '#domql/language/DefinitionWriter.mjs';

const panel = document.createElement('div');

describe('DefinitionWriter', () => {
    it.each([
        '@panel.size',
        '@panel.attributeOf("data-key")',
        '@panel.intersects(root: @panel, margin: 10)',
        '@panel { size: size, box: { width: size.width }, kind: "panel", rank: 3, none: null }',
        '@panel.children.where(is "attached").max(size.width)',
        '@panel is ("attached" or "focused") and "disabled"',
        '@panel has "children"',
        '@window { ratio: devicePixelRatio, visible: @document is "visible" }',
    ])('writes text that parses back to the same definition: %s', text => {
        const { definition } = Domql.parse(text, { panel });

        expect(Domql.parse(DefinitionWriter.write(definition.query), { panel }).definition).toEqual(definition);
    });

    it('writes a member by its path and its arguments, by name where they are named', () => {
        const { definition } = Domql.parse('@panel.intersects(@panel, margin: 5)', { panel });

        expect(DefinitionWriter.write(definition.query)).toBe('@panel.intersects(@panel, margin: 5)');
    });
});
