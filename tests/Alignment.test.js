import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { Domql } from '#domql/domql.js';

// A path from the repository root, read as text.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');

describe('Alignment', () => {
    const specification = read('docs/domql-specification.md');
    const design = read('docs/domql-design.md');
    const project = read('nuget/Forma.DOMQL.csproj');

    it('has a specification whose version is that of the implementation', () => {
        const [, version] = specification.match(/^# DOMQL Specification v(\d+\.\d+\.\d+)$/m);

        expect(version).toBe(Domql.specificationVersion);
    });

    it('has a design titled with the version of the specification', () => {
        const [, version] = design.match(/^# DOMQL Design v(\d+\.\d+\.\d+)$/m);

        expect(version).toBe(Domql.specificationVersion);
    });

    it('has a package version whose major and minor are those of the specification and whose preview is its revision', () => {
        const [, major, minor, preview] = project.match(/<Version>(\d+)\.(\d+)\.\d+(?:-preview\.(\d+))?<\/Version>/);
        const [specificationMajor, specificationMinor, revision] = Domql.specificationVersion.split('.');

        expect([major, minor]).toEqual([specificationMajor, specificationMinor]);
        expect(preview === undefined || preview === revision).toBe(true);
    });

    it('has a specification whose example definition is of the version the implementation writes', () => {
        const [, version] = specification.match(/"version": (\d+),\s+"query"/);

        expect(Number(version)).toBe(Domql.parse('@panel { size }').definition.version);
    });
});
