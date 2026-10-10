// How a TypeScript caller uses DOMQL, which the declarations must accept; the test compiles this file.
import { Domql } from '../../src/domql.js';
import type { DefinitionNode, DomqlError, DomqlEventListener, DomqlModule, DomqlCurrentSnapshot, DomqlWatch, ModuleContents, ModuleFunctions, PredicateNames, ResolvedDefinition, SnapshotBaseline, SnapshotChangeSet, SnapshotUpdate } from '../../src/domql.js';

const panel = document.createElement('div');

const query = Domql.parse('@panel { count: children.count }', { panel });
const optional = Domql.parse('@panel { size }', { panel: Domql.bind(null, 'element?'), ids: Domql.bind([], 'list<number>') });
const created = Domql.create(query.definition, { panel });

const answer = Domql.read<{ count: number }>(query);
const count: number = answer.count;
const anything: unknown = Domql.read(optional, { window });
const waited: Promise<{ count: number }> = Domql.readAsync<{ count: number }>(query, { window, signal: new AbortController().signal });

const watch: DomqlWatch<{ count: number }> = Domql.watch<{ count: number }>(query, {
    onChange: snapshot => {
        const total: number = snapshot.count;

        return total;
    },
    onError: error => Promise.resolve(error),
    schedule: 'immediate',
    updateStrategy: 'snapshot',
    acceptPartialObservation: true,
    window,
});
const status: 'pending' | 'ready' | 'failed' | 'disposed' = watch.status;
const lastSnapshot: { count: number } | null = watch.lastSnapshot;
const refreshed: Promise<void> = watch.refreshAsync();
watch.dispose();

const resolved: ResolvedDefinition = Domql.resolve(created, { watch: true, acceptPartialObservation: true });
const kind: 'query' | 'subscription' | 'action' | 'behavior' = resolved.kind;
const typeText: string = resolved.type.toString();

const contents: ModuleContents = {
    types: [{ name: 'childMetrics', fields: { childCount: 'number' } }],
    members: [{ name: 'metrics', function: 'readMetrics', kind: 'property', on: 'element', parameters: [], result: 'childMetrics', changes: 'unobserved', reads: 'fresh', tolerance: 0.5 }],
    eventTypes: [{ name: 'chart-selected', payload: 'number' }],
    predicates: [{ verb: 'is', name: 'plotted', function: 'isPlotted', on: 'element', changes: 'observable', reads: 'fresh', observations: [{ type: 'mutation', of: 'receiver', attributes: true }] }],
    features: ['share'],
    observationTypes: [{ name: 'chartsChanged', contract: 'maintained', identity: ['root'], shared: true, function: 'observeCharts' }],
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

const shorthand: number = Domql.read<number>('@panel.children.count', { panel });
const shorthandAsync: Promise<number> = Domql.readAsync<number>('@panel.children.count', { panel }, { window, signal: new AbortController().signal });
const shorthandWatch: DomqlWatch<number> = Domql.watch<number>('@panel.children.count', { panel }, { onChange: count => count });
const shorthandResolved: ResolvedDefinition = Domql.resolve('@panel.children.count', { panel }, { watch: true });

// @ts-expect-error A query is given as a query or its text.
Domql.read(42);

const clicks: DomqlEventListener<{ x: number }> = Domql.subscribe<{ x: number }>(Domql.parse('@panel.eventsOf("click") { x: clientX }', { panel }), {
    onEvent: click => click.x,
    onError: error => console.error(error),
});
const keys: DomqlEventListener<{ key: string }> = Domql.subscribe<{ key: string }>('@panel.eventsOf("keydown") { key }', { panel }, { onEvent: press => press.key, window });
const listening: 'ready' | 'disposed' = clicks.status;

keys.dispose();

// @ts-expect-error An event listener takes the function that receives each event's result.
Domql.subscribe(query, {});

// @ts-expect-error The callback of an event listener is onEvent.
Domql.subscribe(query, { onChange: () => {} });

// A source takes the function it delivers each occurrence to, and answers what stops it.
const sourceFunctions: ModuleFunctions = {
    beats: (element: Element, _args: Record<string, unknown>, _environment: { window: Window }, deliver: (occurrence: unknown) => void) => {
        const timer = setInterval(() => deliver({ n: element.childElementCount }), 1000);

        return { stop: () => clearInterval(timer) };
    },
};

// @ts-expect-error A watch takes the function that receives its snapshots.
Domql.watch(query, {});

// @ts-expect-error A watch is scheduled by frame or immediately.
Domql.watch(query, { onChange: () => {}, schedule: 'later' });

const current: DomqlCurrentSnapshot<{ count: number }> = Domql.createSnapshot<{ count: number }>();
const changing: DomqlWatch<{ count: number }> = Domql.watch<{ count: number }>(query, {
    updateStrategy: 'changeSet',
    onChange: (update: SnapshotUpdate<{ count: number }>) => {
        if (update.kind === 'baseline') {
            const baseline: SnapshotBaseline<{ count: number }> = update;
            const whole: { count: number } = baseline.snapshot;
        } else {
            const changeSet: SnapshotChangeSet = update;
            const operations: number = changeSet.patch.length;
        }

        const outcome: 'accepted' | 'stale' | 'failed' = current.apply(update);

        if (outcome === 'accepted') {
            changing.acknowledge(update);
        } else if (outcome === 'failed') {
            changing.recover();
        }
    },
});

// In snapshot mode, onChange receives the snapshot itself, never an update.
Domql.watch<{ count: number }>(query, { onChange: snapshot => snapshot.count });

// @ts-expect-error A watch that delivers snapshots hands over no update.
Domql.watch<{ count: number }>(query, { onChange: (update: SnapshotUpdate<{ count: number }>) => update.kind });
const latest: { count: number } | null = current.value;

// @ts-expect-error The update strategy of a watch is snapshots or change sets.
Domql.watch(query, { onChange: () => {}, updateStrategy: 'patch' });

const tested = Domql.parse('@panel is "attached" or ("disabled" and "focused")', { panel }).definition.query;

if (tested.kind === 'predicate') {
    const verb: 'is' | 'has' = tested.verb;
    const names: PredicateNames = tested.test;
}

// @ts-expect-error A test reads its names under is or has.
const misread: DefinitionNode = { kind: 'predicate', verb: 'was', test: { kind: 'literal', value: 'attached' } };

// @ts-expect-error A query's text is a string.
Domql.parse(42);

// @ts-expect-error A member is one of the kinds the language has.
Domql.createModule('bad', { members: [{ name: 'bad', function: 'bad', kind: 'method', on: 'element', result: 'number', changes: 'constant', reads: 'fresh' }] });

export { count, anything, kind, typeText, listening, sourceFunctions };
