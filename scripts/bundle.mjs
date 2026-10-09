/**
 * bundle — DOMQL as the single, minified file the package ships
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the package serves the bundle from. */
export const bundlePath = resolve(root, 'nuget', 'wwwroot', 'domql.js');

/** Bundles the entry and every module it imports into one minified ES module, answering its text. */
export async function bundle() {
    const result = await build({
        entryPoints: [resolve(root, 'src', 'domql.js')],
        bundle: true,
        minify: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        legalComments: 'none',
        write: false,
    });

    return result.outputFiles[0].text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const text = await bundle();

    await mkdir(dirname(bundlePath), { recursive: true });
    await writeFile(bundlePath, text);

    console.log(`Bundled ${Buffer.byteLength(text)} bytes to ${bundlePath}`);
}
