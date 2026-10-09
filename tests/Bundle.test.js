import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, it, expect } from 'vitest';
import { bundle } from '../scripts/bundle.mjs';

/** The bundle's single export, which names Domql. */
const EXPORT = /export\{([\w$]+) as Domql\};?\s*$/;

describe('Bundle', () => {
    let text;
    let bundled;

    beforeAll(async () => {
        text = await bundle();
        bundled = new Function(text.replace(EXPORT, 'return { Domql: $1 };'))();
    });

    it('is one file that imports nothing', () => {
        expect(text).not.toMatch(/\bimport\s*[({"'*\w]/);
    });

    it('exports Domql alone', () => {
        expect(text).toMatch(EXPORT);
        expect(text.match(/\bexport\b/g)).toHaveLength(1);
    });

    it('is less than half the size of the sources it bundles', async () => {
        const sources = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
        const files = (await readdir(sources, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name));
        const size = (await Promise.all(files.map(file => readFile(file, 'utf8')))).reduce((total, source) => total + source.length, 0);

        expect(text.length).toBeLessThan(size / 2);
    });

    it('parses and creates queries as the sources do', () => {
        const query = bundled.Domql.parse('@panel { size, hasFocus: matches ":focus-within" }', { panel: 1 });

        expect(query.definition.query.fields.map(field => field.name ?? 'inferred')).toEqual(['inferred', 'hasFocus']);
        expect(bundled.Domql.create(query.definition, { panel: 2 }).bindings.get('panel')).toBe(2);
        expect(bundled.Domql.specificationVersion).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('keeps the errors the sources raise', () => {
        expect(() => bundled.Domql.parse('@panel {')).toThrow(/Expected/);
    });
});
