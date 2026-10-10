/**
 * vocabulary-types — the TypeScript types of the fluent builder's expressions for the built-in vocabulary, generated from its declarations into domql.d.ts
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Type } from '../src/language/Type.mjs';
import { Vocabulary } from '../src/language/vocabulary/Vocabulary.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the declarations are, and the lines the generated types stand between. */
export const declarationsSource = resolve(root, 'src', 'domql.d.ts');
const START = '// <generated: the built-in vocabulary\'s expressions, by scripts/vocabulary-types.mjs>';
const END = '// </generated>';

/** The value each data type is in TypeScript. */
const VALUES = { number: 'number', string: 'string', boolean: 'boolean', element: 'Element' };

/** The types whose expressions have members of their own: the roots, the element, and each structured type. */
const expressionName = name => `Domql${name[0].toUpperCase()}${name.slice(1)}Expression`;

/** The generated types, as the text that stands between the markers. */
export function generate() {
    const vocabulary = Vocabulary.module;
    const structured = new Map(vocabulary.types.map(type => [type.name, type.fields]));
    const named = ['element', 'window', 'document', ...structured.keys()];
    const lines = [START, ''];

    for (const name of named) {
        lines.push(...namedExpression(vocabulary, name, structured), '');
    }

    lines.push(...listExpression(vocabulary), '');
    lines.push(...withNull(named), '');
    lines.push(END);

    return lines.join('\n');
}

/** The expression of a named type: its fields, its members, its tests and its shape. */
function namedExpression(vocabulary, name, structured) {
    const fields = structured.get(name) ?? {};
    const lines = [`/** An expression of ${article(name)} \`${name}\` in a build, null where \`N\` is. */`, `export interface ${expressionName(name)}<N extends null = never> {`];
    const value = name === 'element' ? 'Element' : name === 'window' ? 'Window' : name === 'document' ? 'Document' : valueOf(Type.parse(name), structured);

    lines.push(`    readonly [domqlValue]: ${value} | N;`, `    readonly [domqlType]: '${name}';`);

    for (const [field, text] of Object.entries(fields)) {
        lines.push(`    readonly ${field}: ${expressionOf(Type.parse(text), 'N', structured)};`);
    }

    for (const declaration of vocabulary.members.filter(member => [member.on].flat().includes(name))) {
        lines.push(...memberLines(declaration, 'N', structured, vocabulary));
    }

    if (vocabulary.predicates.some(predicate => [predicate.on].flat().includes(name))) {
        const names = verb => vocabulary.predicates.filter(predicate => predicate.verb === verb && [predicate.on].flat().includes(name)).map(predicate => predicate.name);

        lines.push(`    /** A test of the value, by the names \`is\` reads on it, ${names('is').join(', ') || 'none'}, joined by \`and\` and \`or\`. */`, '    is(names: string): DomqlValueExpression<boolean | N>;');

        if (names('has').length > 0) {
            lines.push(`    /** A test of the value, by the names \`has\` reads on it, ${names('has').join(', ')}, joined by \`and\` and \`or\`. */`, '    has(names: string): DomqlValueExpression<boolean | N>;');
        }
    }

    lines.push(
        '    /** A shape of the value, whose fields the projection returns. */',
        `    select<P extends DomqlProjection>(projection: (value: ${expressionName(name)}) => P): DomqlShapeExpression<DomqlProjected<P>, N>;`,
        '    /** A member read by its name, as the vocabulary resolves it. */',
        '    get(name: string): DomqlUnresolvedExpression;',
        '}',
    );

    return lines;
}

/** The expression of a list, whose items are expressions of the type `I`: the list's members, and a shape of each item. */
function listExpression(vocabulary) {
    const lines = [
        '/** An expression of a list in a build, whose items are expressions of the type `I`, null where `N` is. */',
        'export interface DomqlListExpression<I, N extends null = never> {',
        '    readonly [domqlValue]: DomqlValueOf<I>[] | N;',
        "    readonly [domqlType]: 'list';",
    ];

    for (const declaration of vocabulary.members.filter(member => [member.on].flat().includes('list<T>'))) {
        lines.push(...memberLines(declaration, 'N', new Map(vocabulary.types.map(type => [type.name, type.fields])), vocabulary));
    }

    lines.push(
        '    /** A shape of each item, whose fields the projection returns. */',
        '    select<P extends DomqlProjection>(projection: (item: I) => P): DomqlListExpression<DomqlShapeExpression<DomqlProjected<P>>, N>;',
        '    /** A member read by its name, as the vocabulary resolves it. */',
        '    get(name: string): DomqlUnresolvedExpression;',
        '}',
    );

    return lines;
}

/** An expression made nullable: the same expression, of its value or null. */
function withNull(named) {
    return [
        '/** The expression `P`, of its value or null where `M` is. */',
        'export type DomqlWithNull<P, M extends null> =',
        ...named.map(name => `    P extends { readonly [domqlType]: '${name}' } ? ${expressionName(name)}<M> :`),
        "    P extends { readonly [domqlType]: 'list' } ? (P extends DomqlListExpression<infer I, null> ? DomqlListExpression<I, M> : P) :",
        "    P extends { readonly [domqlType]: 'shape'; readonly [domqlValue]: infer S } ? DomqlShapeExpression<Exclude<S, null>, M> :",
        '    P extends { readonly [domqlValue]: infer V } ? DomqlValueExpression<V | M> :',
        '    P;',
    ];
}

/** The lines of a member: a field-like property, a property that takes arguments too, or a method with each way its arguments can be given. */
function memberLines(declaration, nullName, structured, vocabulary) {
    const resultOf = () => expressionOf(Type.parse(declaration.result), nullName, structured);
    const doc = `    /** \`${declaration.name}\`, ${declaration.kind === 'source' ? 'an occurrence source' : `${article(declaration.kind)} ${declaration.kind}`} of the built-in vocabulary. */`;

    if (declaration.name === 'get') {
        return [];
    }

    if (declaration.kind === 'source') {
        return vocabulary.eventTypes.flatMap(event => [
            `    /** The \`${event.name}\` events that reach the value, each a \`${event.payload}\`. */`,
            `    ${declaration.name}(type: '${event.name}'): DomqlOccurrenceExpression<${expressionOf(Type.parse(event.payload), 'never', structured)}>;`,
        ]);
    }

    const parameters = declaration.parameters;

    if (declaration.kind === 'property' && parameters.length === 0) {
        return [doc, `    readonly ${declaration.name}: ${resultOf()};`];
    }

    const signatures = callSignatures(parameters, structured, vocabulary).map(signature => `${signature}: ${resultOf()}`);

    if (declaration.kind === 'property') {
        return [doc, `    readonly ${declaration.name}: ${resultOf()} & { ${signatures.map(signature => `${signature};`).join(' ')} };`];
    }

    return [doc, ...signatures.map(signature => `    ${declaration.name}${signature};`)];
}

/** Every way a member's arguments can be given: by position, by name, and by position first and by name after. */
function callSignatures(parameters, structured, vocabulary) {
    const typed = parameters.map(parameter => ({ parameter, ts: parameterType(parameter, structured, vocabulary) }));
    // An argument given by position before others given by name is given, so it is required there.
    const positional = (list, isPrefix = false) => list.map(({ parameter, ts }) => `${parameter.name}${parameter.required || isPrefix ? '' : '?'}: ${ts}`).join(', ');
    const named = list => `named: { ${list.map(({ parameter, ts }) => `${parameter.name}${parameter.required ? '' : '?'}: ${ts};`).join(' ')} }`;
    const signatures = [`(${positional(typed)})`];

    for (let count = typed.length - 1; count >= 0; count--) {
        const head = positional(typed.slice(0, count), true);

        signatures.push(`(${head === '' ? '' : `${head}, `}${named(typed.slice(count))})`);
    }

    return signatures;
}

/** What a parameter takes: a value or an expression of one, a callback over each item for an expression, and a name the vocabulary declares for a fixed one. */
function parameterType(parameter, structured, vocabulary) {
    const type = Type.parse(parameter.type);

    if (parameter.kind === 'expression') {
        const value = valueOf(type, structured);
        const literal = type.toNonNullable().name === 'boolean' ? '' : ` | ${value}`;

        return `(item: I) => DomqlExpression<${value}>${literal}`;
    }

    if (parameter.fixed && parameter.selects === 'feature') {
        return vocabulary.features.map(feature => `'${feature}'`).join(' | ');
    }

    const value = valueOf(type.toNonNullable(), structured);
    const accepted = type.isNullable || parameter.nulls === 'accept' ? `${value} | null` : value;

    return `${accepted} | DomqlExpression<${value} | null>`;
}

/** The TypeScript value of a DOMQL type. */
function valueOf(type, structured) {
    const base = (() => {
        switch (type.kind) {
            case 'list':
                return `${valueOf(type.item, structured)}[]`;
            case 'null':
                return 'null';
            case 'named':
                if (VALUES[type.name] !== undefined) {
                    return VALUES[type.name];
                }

                if (structured.has(type.name)) {
                    return `{ ${Object.entries(structured.get(type.name)).map(([field, text]) => `${field}: ${valueOf(Type.parse(text), structured)};`).join(' ')} }`;
                }

                return 'unknown';
            default:
                return 'unknown';
        }
    })();

    return type.isNullable && type.kind !== 'null' ? `${base} | null` : base;
}

/** The expression of a member's result, null where its receiver is, where the type is nullable, or both. */
function expressionOf(type, nullName, structured) {
    const nulls = type.isNullable && type.kind !== 'null' ? (nullName === 'never' ? 'null' : `${nullName} | null`) : nullName;

    switch (type.kind) {
        case 'null':
            return 'DomqlValueExpression<null>';
        case 'variable':
            return type.name === 'T' ? `DomqlWithNull<I, ${nulls}>` : 'DomqlUnresolvedExpression';
        case 'list':
            return `DomqlListExpression<${expressionOf(type.item, 'never', structured)}, ${nulls}>`;
        default:
            if (['element', 'window', 'document', ...structured.keys()].includes(type.name)) {
                return `${expressionName(type.name)}<${nulls}>`;
            }

            return `DomqlValueExpression<${VALUES[type.name] ?? 'unknown'} | ${nulls}>`;
    }
}

function article(name) {
    return /^[aeiou]/.test(name) ? 'an' : 'a';
}

/** The declarations with the generated types put between their markers. */
export async function declarationsWithTypes() {
    const text = await readFile(declarationsSource, 'utf8');
    const start = text.indexOf(START);
    const end = text.indexOf(END);

    if (start === -1 || end === -1) {
        throw new Error(`The declarations hold no markers for the generated types: ${START}`);
    }

    return `${text.slice(0, start)}${generate()}${text.slice(end + END.length)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await writeFile(declarationsSource, await declarationsWithTypes());

    console.log(`Generated the built-in vocabulary's expression types into ${declarationsSource}`);
}
