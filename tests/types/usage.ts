// How a TypeScript caller uses DOMQL, which the declarations must accept; the test compiles this file.
import { Domql } from '../../src/domql.js';
import type { DomqlBehavior, DomqlChangeOperation, DomqlDefinitionNode, DomqlReadOnly, DomqlError, DomqlEventListener, DomqlModule, DomqlCurrentSnapshot, DomqlReadAsyncOptions, DomqlSubscribeConfiguration, DomqlWatch, DomqlWatchChangeSetConfiguration, DomqlWatchConfiguration, DomqlModuleContents, DomqlModuleFunctions, DomqlPredicateNames, DomqlResolvedDefinition, DomqlSnapshotBaseline, DomqlSnapshotChangeSet, DomqlSnapshotUpdate } from '../../src/domql.js';

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

const resolved: DomqlResolvedDefinition = Domql.resolve(created, { watch: true, acceptPartialObservation: true });
const kind: 'query' | 'subscription' | 'action' | 'behavior' = resolved.kind;
const typeText: string = resolved.type.toString();

const contents: DomqlModuleContents = {
    types: [{ name: 'childMetrics', fields: { childCount: 'number' } }],
    members: [{ name: 'metrics', function: 'readMetrics', kind: 'property', on: 'element', parameters: [], result: 'childMetrics', changes: 'unobserved', reads: 'fresh', tolerance: 0.5 }],
    eventTypes: [{ name: 'chart-selected', payload: 'number' }],
    predicates: [{ verb: 'is', name: 'plotted', function: 'isPlotted', on: 'element', changes: 'observable', reads: 'fresh', observations: [{ type: 'mutation', of: 'receiver', attributes: true }] }],
    features: ['share'],
    observationTypes: [{ name: 'chartsChanged', contract: 'maintained', identity: ['root'], shared: true, function: 'observeCharts' }],
};
const functions: DomqlModuleFunctions = {
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
const shorthandResolved: DomqlResolvedDefinition = Domql.resolve('@panel.children.count', { panel }, { watch: true });

// @ts-expect-error A query is given as a query or its text.
Domql.read(42);

// @ts-expect-error A query carries its own bindings, so only its options follow it.
Domql.read(query, { panel }, { window });

// @ts-expect-error A watch of a text takes its bindings before its configuration, `{}` where it has none.
Domql.watch('@window.size', { onChange: () => {} });

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
const sourceFunctions: DomqlModuleFunctions = {
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
    onChange: (update: DomqlSnapshotUpdate<{ count: number }>) => {
        if (update.kind === 'baseline') {
            const baseline: DomqlSnapshotBaseline<{ count: number }> = update;
            const whole: { count: number } = baseline.snapshot;
        } else {
            const changeSet: DomqlSnapshotChangeSet = update;
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
Domql.watch<{ count: number }>(query, { onChange: (update: DomqlSnapshotUpdate<{ count: number }>) => update.kind });
const latest: { count: number } | null = current.value;

// @ts-expect-error The update strategy of a watch is snapshots or change sets.
Domql.watch(query, { onChange: () => {}, updateStrategy: 'patch' });

const tested = Domql.parse('@panel is "attached" or ("disabled" and "focused")', { panel }).definition.query;

if (tested.kind === 'predicate') {
    const verb: 'is' | 'has' = tested.verb;
    const names: DomqlPredicateNames = tested.test;
}

// @ts-expect-error A test reads its names under is or has.
const misread: DomqlDefinitionNode = { kind: 'predicate', verb: 'was', test: { kind: 'literal', value: 'attached' } };

// @ts-expect-error A query's text is a string.
Domql.parse(42);

// @ts-expect-error A member is one of the kinds the language has.
Domql.createModule('bad', { members: [{ name: 'bad', function: 'bad', kind: 'method', on: 'element', result: 'number', changes: 'constant', reads: 'fresh' }] });

// Live state is one object the watch keeps current, which the caller reads and never writes.
const living: DomqlWatch<{ rows: { key: string }[] }> = Domql.watch<{ rows: { key: string }[] }>('{ rows: @panel.children { key: attributeOf "data-key" } }', { panel }, {
    updateStrategy: 'liveState',
    onChange: (state, changes) => {
        const first: string | undefined = state.rows[0]?.key;
        const applied: readonly DomqlChangeOperation[] = changes;

        // @ts-expect-error Live state is read-only to the caller that holds it.
        state.rows[0].key = 'changed';

        return [first, applied];
    },
});
const held: DomqlReadOnly<{ rows: { key: string }[] }> | null = living.liveState;

// An action runs once and promises its result; a behavior is in effect until its handle is disposed.
const moved: Promise<boolean> = Domql.runAsync<boolean>('@panel.step("forward")', { panel }, { window, signal: new AbortController().signal });
const stepped: Promise<boolean> = Domql.runAsync<boolean>(query, { window });
const trap: DomqlBehavior = Domql.activate('@dialog.focusTrap', { dialog: panel });
const trapping: 'ready' | 'disposed' = trap.status;

trap.update({ dialog: panel });
trap.dispose();
Domql.activate(query, { window });

// @ts-expect-error A behavior's handle is updated with bindings.
trap.update('@dialog.focusTrap');

// @ts-expect-error A query carries its own bindings, so only its options follow it.
Domql.activate(query, { panel }, { window });

// The configurations a watch and a subscription take, and the options of a read, by their names.
const watching: DomqlWatchConfiguration<number> = { onChange: count => count, schedule: 'immediate' };
const changeSetWatching: DomqlWatchChangeSetConfiguration<number> = { updateStrategy: 'changeSet', onChange: update => update.kind };
const subscribing: DomqlSubscribeConfiguration<{ key: string }> = { onEvent: press => press.key };
const reading: DomqlReadAsyncOptions = { window, signal: new AbortController().signal };

Domql.watch<number>(query, watching);
Domql.watch<number>(query, changeSetWatching);
Domql.subscribe<{ key: string }>('@panel.eventsOf("keydown") { key }', { panel }, subscribing);
Domql.readAsync(query, reading);

export { count, anything, kind, typeText, listening, sourceFunctions, moved, stepped, trapping, held };
