import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { Domql } from '#domql/domql.js';
import { declarationsWithTypes } from '../scripts/vocabulary-types.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const declarations = readFileSync(resolve(here, '..', 'src', 'domql.d.ts'), 'utf8');

describe('the declarations', () => {
    it('declare every static member of Domql, and only those', () => {
        const runtime = Object.getOwnPropertyNames(Domql).filter(name => !['length', 'name', 'prototype'].includes(name)).sort();
        const [, body] = declarations.match(/export declare class Domql \{([\s\S]*)\n\}/);
        // A member declared with overloads is one member.
        const declared = [...new Set([...body.matchAll(/^\s{4}static (?:readonly )?(\w+)/gm)].map(match => match[1]))].sort();

        expect(declared).toEqual(runtime);
    });

    it('hold the expression types the built-in vocabulary generates, as they are now', async () => {
        // A failure here means the vocabulary changed: run `node scripts/vocabulary-types.mjs` from the repository's root.
        expect(declarations).toBe(await declarationsWithTypes());
    });

    it('accept how a TypeScript caller uses the library, and refuse its misuse', () => {
        const program = ts.createProgram([resolve(here, '_types', 'usage.ts')], {
            strict: true,
            noEmit: true,
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
            types: [],
        });
        const messages = ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));

        expect(messages).toEqual([]);
    });
});
