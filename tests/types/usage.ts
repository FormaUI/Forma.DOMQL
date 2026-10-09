// How a TypeScript caller uses DOMQL, which the declarations must accept; the test compiles this file.
import { Domql } from '../../src/domql.js';
import type { DomqlError, DomqlModule, ModuleContents, ModuleFunctions, ResolvedDefinition } from '../../src/domql.js';

const panel = document.createElement('div');

const query = Domql.parse('@panel { count: children.count }', { panel });
const optional = Domql.parse('@panel { size }', { panel: Domql.bind(null, 'element?'), ids: Domql.bind([], 'list<number>') });
const created = Domql.create(query.definition, { panel });

const answer = Domql.read<{ count: number }>(query);
const count: number = answer.count;
const anything: unknown = Domql.read(optional, window);

const resolved: ResolvedDefinition = Domql.resolve(created, { watch: true, acceptPartialObservation: true });
const kind: 'query' | 'subscription' | 'action' | 'behavior' = resolved.kind;
const typeText: string = resolved.type.toString();

const contents: ModuleContents = {
    types: [{ name: 'childMetrics', fields: { childCount: 'number' } }],
    members: [{ name: 'metrics', builder: 'metrics', function: 'readMetrics', kind: 'property', on: 'element', parameters: [], result: 'childMetrics', changes: 'unobserved', reads: 'fresh' }],
    eventTypes: [{ name: 'chart-selected', payload: 'number' }],
    predicates: [{ verb: 'is', name: 'plotted', function: 'isPlotted', on: 'element', changes: 'observable', reads: 'fresh' }],
    features: ['share'],
};
const functions: ModuleFunctions = {
    readMetrics: (element: Element) => ({ childCount: element.children.length }),
    isPlotted: () => true,
};
const module: DomqlModule = Domql.createModule('metrics', contents, functions);

Domql.registerModule(module);

try {
    Domql.read(Domql.parse('@panel.nonsense', { panel }));
} catch (error) {
    if ((error as Error).name === 'DomqlError') {
        const failure = error as DomqlError;
        const failureKind: 'syntax' | 'structure' | 'validation' | 'module' | 'evaluation' = failure.kind;
        const line: number | undefined = failure.location.line;

        console.error(failureKind, line);
    }
}

// @ts-expect-error A query is read, not a string.
Domql.read('@panel.children.count');

// @ts-expect-error A query's text is a string.
Domql.parse(42);

// @ts-expect-error A member is one of the kinds the language has.
Domql.createModule('bad', { members: [{ name: 'bad', builder: 'bad', function: 'bad', kind: 'method', on: 'element', result: 'number', changes: 'constant', reads: 'fresh' }] });

export { count, anything, kind, typeText };
