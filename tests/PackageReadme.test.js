import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, it, expect, vi } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const packageReadme = readFileSync(resolve(here, '..', 'nuget', 'README.md'), 'utf8');
const repositoryReadme = readFileSync(resolve(here, '..', 'README.md'), 'utf8');

/** A fixture: the text of a README block, kept as it is written there. */
const fixture = name => readFileSync(resolve(here, 'readme', name), 'utf8').trim();

/** The fenced blocks of a language in a document, in order. */
const blocks = (document, language) => [...document.matchAll(new RegExp('```' + language + '\\n([\\s\\S]*?)```', 'g'))].map(match => match[1].trim());

/** The value the lines of a comment write, which throws where they write prose or anything else that is no value. */
const valueOf = lines => new Function(`return (${lines.join('\n')});`)();

/**
 * The package README's examples, in the order it shows them. Each is a fixture holding the block as written, run in the one scope the README's examples share.
 * `answers` are the comment lines after the example, one list for each answer it shows; `observed` says where the example's answers come from:
 * what it reads, what it logs, or the expressions it ends in.
 */
const examples = [
    {
        file: '01-read-a-query.js',
        observed: 'reads',
        answers: [['{', '  count: 3,', '  items: [', "    { key: 'a1', selected: false },", "    { key: 'a2', selected: true },", "    { key: 'a3', selected: false }", '  ]', '}']],
    },
    { file: '02-read-again.js', observed: 'reads', answers: [['3'], ['0']] },
    { file: '03-paths.js', observed: 'reads', answers: [['3'], ['3'], ['true']] },
    { file: '04-shapes.js', observed: 'reads', answers: [['{ count: 3, attached: true, children: true }']] },
    {
        file: '05-shapes-of-lists.js',
        observed: 'reads',
        answers: [['[', "  { key: 'a1', selected: false },", "  { key: 'a2', selected: true },", "  { key: 'a3', selected: false }", ']']],
    },
    { file: '06-lists.js', observed: 'reads', answers: [['1'], ['64']] },
    { file: '07-null.js', observed: 'reads', answers: [['null']] },
    { file: '08-bindings.js', observed: 'reads', answers: [['{ panel: null, ids: [] }']] },
    { file: '09-resolve.js', observed: 'inspected', inspect: '[resolved.kind, resolved.type.toString()]', answers: [["'query'"], ["'number?'"]] },
    {
        file: '10-errors.js',
        observed: 'logged',
        answers: [['validation'], ["The argument 'name' of 'attributeOf' expects string and finds number", '(line 1, column 20, at /query/arguments/0/value)']],
    },
    { file: '11-module.js', observed: 'reads', answers: [['{ childCount: 3 }']] },
];

/** Gives each element with an inline height a layout box of that height, since the test environment lays nothing out. */
const layOut = document => {
    for (const element of document.querySelectorAll('[style*="height"]')) {
        const height = Number.parseFloat(element.style.height);
        const box = { left: 0, top: 0, width: 0, height, right: 0, bottom: height };

        element.getBoundingClientRect = () => box;
        element.getClientRects = () => [box];
    }
};

describe('the package README', () => {
    const results = [];

    beforeAll(async () => {
        vi.resetModules();

        const { Domql: real } = await import('#domql/domql.js');
        const reads = [];
        const logged = [];

        // The examples call Domql as the README writes it, and every read it answers is kept.
        const Domql = new Proxy(real, {
            get: (target, key) => key === 'read' ? (...args) => { const answer = target.read(...args); reads.push(answer); return answer; } : target[key],
        });

        document.body.innerHTML = fixture('document.html');
        layOut(document);

        const mark = (index, inspect) => {
            results[index] = { reads: reads.splice(0), logged: logged.splice(0), inspected: inspect === null ? [] : inspect() };
        };

        const script = examples.map((example, index) => `${fixture(example.file)}\nmark(${index}, ${example.inspect === undefined ? 'null' : `() => ${example.inspect}`});`).join('\n');
        const log = vi.spyOn(console, 'error').mockImplementation((...parts) => logged.push(parts));

        try {
            new Function('Domql', 'document', 'mark', script)(Domql, document, mark);
        } finally {
            log.mockRestore();
        }
    });

    describe.each(examples.map(example => [example.file, example]))('%s', (file, example) => {
        const index = examples.indexOf(example);

        it('is written in the README as it is run here', () => {
            expect(packageReadme).toContain(fixture(file));
        });

        it('shows the answers that are the lines of its comments', () => {
            const comments = fixture(file).split('\n').map(line => line.trimEnd());

            for (const line of example.answers.flat()) {
                expect(comments.some(comment => comment.endsWith(`// ${line}`)), line).toBe(true);
            }
        });

        it('gives the answers it shows', () => {
            const { reads, logged, inspected } = results[index];

            if (example.observed === 'logged') {
                const [kind, message] = example.answers;

                expect(reads).toEqual([]);
                expect(logged).toHaveLength(1);
                expect(logged[0][0]).toBe(kind[0]);
                expect(logged[0][1]).toBe(message.join(' '));
            } else {
                const observed = example.observed === 'reads' ? reads : inspected;

                expect(observed).toEqual(example.answers.map(valueOf));
            }
        });
    });

    it('runs the document it shows', () => {
        expect(blocks(packageReadme, 'html')).toEqual([fixture('document.html')]);
    });

    it('runs every example it shows, and only those', () => {
        const shown = blocks(packageReadme, 'js').filter(block => !block.startsWith('import '));

        expect(shown).toEqual(examples.map(example => fixture(example.file)));
    });
});

describe('the repository README', () => {
    const [firstExample, secondExample, , watchExample, changeExample, disposeExample] = blocks(repositoryReadme, 'js');

    it('shows the document its examples query', () => {
        expect(blocks(repositoryReadme, 'html')[0]).toBe(fixture('document.html'));
    });

    it('gives the result it shows, and the results of reading again, from that document', async () => {
        vi.resetModules();

        const { Domql } = await import('#domql/domql.js');
        const logged = [];

        document.body.innerHTML = fixture('document.html');
        layOut(document);

        // The first two examples share one scope, as they are shown: the second reads the first one's query again.
        const code = `${firstExample.replace(/^import .*\n/, '')}\n${secondExample}\nreturn snapshot;`;
        const snapshot = new Function('Domql', 'document', 'console', code)(Domql, document, { log: value => logged.push(value) });
        // The values are the comments that follow a log; the comments above the code explain it.
        const lines = secondExample.split('\n');
        const comments = lines.filter((line, index) => line.startsWith('// ') && lines[index - 1]?.startsWith('console.log(')).map(line => valueOf([line.slice(3)]));

        expect(snapshot).toEqual(JSON.parse(blocks(repositoryReadme, 'json')[0]));
        expect(logged).toEqual(comments);
    });

    it('delivers the snapshots its watch examples promise', async () => {
        vi.resetModules();

        const { Domql } = await import('#domql/domql.js');
        const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
        const rendered = [];
        const frames = [];
        const settle = () => new Promise(resolve => setTimeout(resolve));

        document.body.innerHTML = fixture('document.html');
        layOut(document);
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => frames.push(callback));

        // The examples share one scope in the order they are shown, and the test waits for what each promises between them.
        const code = [
            firstExample.replace(/^import .*\n/, ''),
            watchExample,
            'await settle();',
            changeExample,
            'await settle();',
            'frames.splice(0).forEach(run => run());',
            disposeExample,
            'return watch;',
        ].join('\n');
        let watch;

        try {
            watch = await new AsyncFunction('Domql', 'document', 'render', 'settle', 'frames', code)(Domql, document, snapshot => rendered.push(snapshot), settle, frames);
        } finally {
            vi.restoreAllMocks();
        }

        expect(rendered).toHaveLength(2);
        expect(rendered[0]).toEqual(JSON.parse(blocks(repositoryReadme, 'json')[0]));
        expect(rendered[1].selected).toEqual([{ key: 'a1' }, { key: 'a2' }]);
        expect(rendered[1].items[2]).toBe(rendered[0].items[2]);
        expect(watch.status).toBe('disposed');
    });
});
