/**
 * The types of DOMQL's public API, shipped beside domql.js.
 */

/** How a query will be carried out, which resolution checks it against. */
export interface DomqlResolveOptions {
    /** Whether the query will be watched. */
    watch?: boolean;
    /** Whether a watch accepts members whose changes its observations only partly cover. */
    acceptPartialObservation?: boolean;
}

/** What a read uses. */
export interface DomqlReadOptions {
    /** The window `@window` stands for, and whose document `@document` stands for; by default the environment's. */
    window?: Window;
}

/** What a read that waits uses. */
export interface DomqlReadAsyncOptions extends DomqlReadOptions {
    /** Cancels the read, which then fails with the signal's reason. */
    signal?: AbortSignal;
}

/** How an action is run. */
export interface DomqlRunAsyncOptions {
    /** The window `@window` stands for, and whose document `@document` stands for; by default the environment's. */
    window?: Window;
    /** Cancels the run: the promise rejects with the signal's reason at once, and the action learns of it through the signal it is given. */
    signal?: AbortSignal;
}

/** How a behavior is activated. */
export interface DomqlActivateOptions {
    /** The window `@window` stands for, and whose document `@document` stands for; by default the environment's. */
    window?: Window;
}

/** A behavior the caller activated: it is in effect from the call that activated it until it is disposed. */
export interface DomqlBehavior {
    /** `ready` while it is in effect, and `disposed` once it is ended. */
    readonly status: 'ready' | 'disposed';
    /** Replaces the bindings the behavior runs with, whole. A failure throws and leaves the behavior running as it was; bindings that select another behavior are refused. */
    update(bindings: DomqlBindings): void;
    /** Ends the behavior and leaves its module registered. Disposing again does nothing. */
    dispose(): void;
}

/** How a query is watched. */
export interface DomqlWatchConfiguration<T = unknown> {
    /** Receives each snapshot, the first as the baseline: an immutable result that shares what did not change with the snapshot before it. What it returns is not awaited. */
    onChange: (snapshot: T) => unknown;
    /** Receives a failure of an evaluation and of `onChange`; by default they go to the window's error reporting. A failure of this callback goes there too. */
    onError?: (error: unknown) => unknown;
    /** When an evaluation follows a change: at the next animation frame, once however many observations fired (the default), or in the task that reported it. */
    schedule?: 'frame' | 'immediate';
    /** How the watch updates its caller: with each snapshot whole, the default. */
    updateStrategy?: 'snapshot';
    /** Whether the watch accepts a member whose observations only partly cover its changes; a watch over one without it is a validation error. */
    acceptPartialObservation?: boolean;
    /** The window `@window` stands for, and whose document `@document` stands for; by default the environment's. */
    window?: Window;
}

/** How a query is watched when its snapshots are delivered as a baseline and then change sets. */
export interface DomqlWatchChangeSetConfiguration<T = unknown> extends Omit<DomqlWatchConfiguration<T>, 'onChange' | 'updateStrategy'> {
    /** Delivers a baseline and then the change sets between snapshots, each sent once the one before it is acknowledged. */
    updateStrategy: 'changeSet';
    /** Receives each update, for the host to apply to a current snapshot; the host acknowledges one that applied, and recovers the watch where one failed or the snapshot was lost. */
    onChange: (update: DomqlSnapshotUpdate<T>) => unknown;
}

/** A value seen through read-only types all the way down, as the live state a watch keeps is to the caller that holds it. */
export type DomqlReadOnly<T> = T extends readonly (infer I)[] ? readonly DomqlReadOnly<I>[] : T extends object ? { readonly [K in keyof T]: DomqlReadOnly<T[K]> } : T;

/** How a query is watched when its result is kept as live state: one object the watch keeps current in place, which keeps its identity. */
export interface DomqlWatchLiveStateConfiguration<T = unknown> extends Omit<DomqlWatchConfiguration<T>, 'onChange' | 'updateStrategy'> {
    /** Keeps one object current in place; the result must be a shape or a list that is never null. */
    updateStrategy: 'liveState';
    /** Receives the live object, the same at every call, and the change set just applied to it, which is empty at the first call. The object is the watch's: the caller reads it and never writes it. */
    onChange: (state: DomqlReadOnly<T>, changes: readonly DomqlChangeOperation[]) => unknown;
}

/** How an event listener listens to a subscription. */
export interface DomqlSubscribeConfiguration<T = unknown> {
    /** Receives the result of each event's projection, immutable data, in the task the event is delivered in. What it returns is not awaited. */
    onEvent: (result: T) => unknown;
    /** Receives a failure of a capture, of a projection and of `onEvent`; by default they go to the window's error reporting. A failure of this callback goes there too. */
    onError?: (error: unknown) => unknown;
    /** The window `@window` stands for, and whose document `@document` stands for; by default the environment's. */
    window?: Window;
}

/** An event listener: it listens from the call that creates it until it is disposed. Its result type is the one its events are projected to. */
export interface DomqlEventListener<T = unknown> {
    /** `ready` while it listens, and `disposed` once it is ended. */
    readonly status: 'ready' | 'disposed';
    /** Stops listening, disposes every session and prevents any new callback invocation; a callback already running may finish. Disposing again does nothing. */
    dispose(): void;
}

/** One operation of a change set: a JSON Patch operation limited to replace, add, remove and move, whose paths are JSON Pointers into the result. */
export type DomqlChangeOperation =
    | { readonly op: 'replace' | 'add'; readonly path: string; readonly value: unknown }
    | { readonly op: 'remove'; readonly path: string }
    | { readonly op: 'move'; readonly from: string; readonly path: string };

/** The complete result that starts a generation of updates, at revision 0. */
export interface DomqlSnapshotBaseline<T = unknown> {
    readonly kind: 'baseline';
    readonly generation: number;
    readonly from: null;
    readonly to: 0;
    readonly snapshot: T;
}

/** The changes from one revision of a generation to the next, relative to the snapshot at the first. */
export interface DomqlSnapshotChangeSet {
    readonly kind: 'changeSet';
    readonly generation: number;
    readonly from: number;
    readonly to: number;
    readonly patch: readonly DomqlChangeOperation[];
}

/** An update of a snapshot, whatever carries it: a baseline or a change set. */
export type DomqlSnapshotUpdate<T = unknown> = DomqlSnapshotBaseline<T> | DomqlSnapshotChangeSet;

/** The current snapshot a watch's change sets build on the receiving side. */
export interface DomqlCurrentSnapshot<T = unknown> {
    /** The snapshot last accepted, immutable; null before the first baseline. Applying an update advances it, and every snapshot read before stays unchanged. */
    readonly value: T | null;
    /** The generation of the baseline the state started from, or null before the first. */
    readonly generation: number | null;
    /** The revision of the state within its generation, or null before the first baseline. */
    readonly revision: number | null;
    /** Applies an update atomically: `accepted` where it applied, to acknowledge; `stale` where it belongs to an older generation or revision, which changes nothing; `failed` where it cannot apply, which leaves the snapshot as it was and asks for recovery. */
    apply(update: DomqlSnapshotUpdate<T>): 'accepted' | 'stale' | 'failed';
}

/** A watch: the handle of a query kept current. */
export interface DomqlWatch<T = unknown> {
    /** `pending` until the first snapshot is available, `ready` while the watch has a current one, `failed` after an evaluation fails, and `disposed` once it is ended. */
    readonly status: 'pending' | 'ready' | 'failed' | 'disposed';
    /** The snapshot last reported, null before the first and where the snapshot itself is null; read beside the status. */
    readonly lastSnapshot: T | null;
    /** The object a watch that delivers live state keeps current, the same from the first snapshot on; null before it, and for a watch of another strategy. */
    readonly liveState: DomqlReadOnly<T> | null;
    /** Evaluates now, and settles once the evaluation has completed and the snapshot it produced, if it differs, has been handed to the callback. Rejects with the failure of its evaluation, resolves without delivering where disposal cancels it, and rejects after disposal. */
    refreshAsync(): Promise<void>;
    /** Ends the watch: cancels what it scheduled, disposes every observation session and prevents any new callback invocation. A callback already running may finish. */
    dispose(): void;
    /** Confirms that the receiver applied a delivery of a watch that delivers change sets, so the next change set is computed against the state it established; a delivery recovery abandoned changes nothing. A watch that delivers snapshots refuses it. */
    acknowledge(update: DomqlSnapshotUpdate<T>): void;
    /** Abandons the current generation of a watch that delivers change sets, and sends the current snapshot as a new baseline. A watch that delivers snapshots refuses it. */
    recover(): void;
}

/** A DOMQL definition: the JSON document that records a query's meaning, without the values its parameters are bound to. */
export interface DomqlDefinition {
    readonly version: number;
    readonly query: DomqlDefinitionNode;
}

/** A node of a definition. */
export type DomqlDefinitionNode =
    | { readonly kind: 'literal'; readonly value: string | number | boolean | null }
    | { readonly kind: 'parameter'; readonly name: string }
    | { readonly kind: 'member'; readonly target?: DomqlDefinitionNode; readonly name: string; readonly arguments: readonly DomqlDefinitionEntry[] }
    | { readonly kind: 'shape'; readonly target?: DomqlDefinitionNode; readonly fields: readonly DomqlDefinitionEntry[] }
    | { readonly kind: 'predicate'; readonly verb: 'is' | 'has'; readonly target?: DomqlDefinitionNode; readonly test: DomqlPredicateNames };

/** The predicate names a test reads: a string, a parameter, or an and or an or of two or more of them. */
export type DomqlPredicateNames =
    | { readonly kind: 'literal'; readonly value: string }
    | { readonly kind: 'parameter'; readonly name: string }
    | { readonly kind: 'and' | 'or'; readonly operands: readonly DomqlPredicateNames[] };

/** An argument of a member or a field of a shape, with the name written for it, if any. */
export interface DomqlDefinitionEntry {
    readonly name?: string;
    readonly value: DomqlDefinitionNode;
}

/** A value bound with the type its caller declares for it, as `Domql.bind` returns. */
export interface DomqlTypedBinding {
    readonly value: unknown;
    /** The declared type, in DOMQL's type notation. */
    readonly type: string;
}

/** Values or typed bindings supplied by parameter name. */
export interface DomqlBindings {
    [name: string]: unknown | DomqlTypedBinding;
}

/** The values a query's parameters are bound to, by name. */
export interface DomqlParameterBindings {
    has(name: string): boolean;
    get(name: string): unknown;
}

/**
 * A DOMQL query: its definition and the values its parameters are bound to.
 * It belongs to the DOMQL instance that made it, and another instance refuses it; `Domql.create` makes it again there from its definition and a plain object of bindings.
 */
export interface DomqlQuery {
    /** The query's definition, without its bound values. */
    readonly definition: DomqlDefinition;
    readonly bindings: DomqlParameterBindings;
}

/** A DOMQL type: a named type, a list, an occurrence source, a shape or a null, each nullable or not. */
export interface DomqlType {
    readonly kind: 'named' | 'list' | 'occurrence' | 'shape' | 'variable' | 'null';
    readonly name: string | null;
    readonly item: DomqlType | null;
    readonly fields: ReadonlyMap<string, DomqlType> | null;
    readonly isNullable: boolean;
    /** The type in DOMQL's notation, such as `number?` or `list<element>`. */
    toString(): string;
}

/** A query resolved against the registered vocabulary. */
export interface DomqlResolvedDefinition {
    readonly definition: DomqlDefinition;
    /** The kind of request: a query, a subscription, an action or a behavior request. */
    readonly kind: 'query' | 'subscription' | 'action' | 'behavior';
    /** The type of the request's result. */
    readonly type: DomqlType;
    /** The declarations the request uses, with where each is used. */
    readonly usedMembers: readonly { readonly declaration: object; readonly pointer: string }[];
    /** What the member node at the JSON Pointer resolved to. */
    getResolution(pointer: string): object | undefined;
}

/** Where a failure is. */
export interface DomqlErrorLocation {
    /** The failing node's JSON Pointer into the definition. */
    pointer?: string;
    offset?: number;
    line?: number;
    column?: number;
    binding?: string;
    module?: string;
    declaration?: string;
}

/** A failure of DOMQL, in the stage it happened in, and where. Its `name` is `DomqlError`. */
export interface DomqlError extends Error {
    readonly name: 'DomqlError';
    readonly kind: 'syntax' | 'structure' | 'validation' | 'module' | 'evaluation';
    readonly location: DomqlErrorLocation;
}

/** How a member changes. */
export type DomqlChangeCategory = 'constant' | 'observable' | 'partly-observable' | 'unobserved' | 'derived';

/** How a member reads. */
export type DomqlReadingMode = 'fresh' | 'maintained' | 'captured' | 'derived';

/** A reference to the argument a call gives for a parameter of the member. */
export interface DomqlArgumentReference {
    argument: string;
}

/** A value an observation gives: a literal, a list of values, or an argument of the member. */
export type DomqlObservationValue = string | number | boolean | null | DomqlArgumentReference | DomqlObservationValue[];

/** An observation that covers a member's changes: its type, what it observes, and the arguments its type takes. */
export interface DomqlObservationDeclaration {
    /** The name of the type of observation, which a module declares. */
    type: string;
    /** What it observes: the receiver, the window, the document, or the argument of the member that names it. */
    of: 'receiver' | 'window' | 'document' | DomqlArgumentReference;
    [argument: string]: DomqlObservationValue | undefined;
}

/** A type of observation: what its observations provide, and the function that starts one. */
export interface DomqlObservationTypeDeclaration {
    name: string;
    /** A signal that a result may have changed, or a sampled value a member reads. */
    contract: 'invalidation' | 'maintained';
    /** The arguments that belong to the identity of an observation, beside its target. */
    identity?: string[];
    /** Whether equivalent requests share one observation. */
    shared?: boolean;
    /** The key of the function that starts an observation, among the module's functions. */
    function: string;
}

/** A parameter of a member. */
export interface DomqlParameterDeclaration {
    name: string;
    kind: 'value' | 'expression';
    /** The parameter's type, in DOMQL's notation. */
    type: string;
    required: boolean;
    default?: unknown;
    /** Whether the argument names something the vocabulary resolves before any evaluation. */
    fixed?: boolean;
    selects?: 'member' | 'occurrence' | 'feature';
    /** Whether a null argument makes the call answer null, or is accepted. */
    nulls: 'propagate' | 'accept';
    /** What an expression argument is evaluated against. */
    context?: 'item';
    omitted?: string;
}

/** A property, operation, source, action or behavior a module adds. */
export interface DomqlMemberDeclaration {
    /** The DOMQL name. */
    name: string;
    /** The key of the function that carries it out, among the module's functions. */
    function?: string;
    kind: 'property' | 'operation' | 'source' | 'action' | 'behavior';
    /** The types it applies to, in DOMQL's notation. */
    on: string | string[];
    parameters?: DomqlParameterDeclaration[];
    /** The type of its result, in DOMQL's notation. */
    result: string;
    changes: DomqlChangeCategory;
    reads: DomqlReadingMode;
    /** The changes a partly observable member's observations miss. */
    misses?: string;
    /** How far a number it returns may move before a watch reports a different snapshot; the number must change by more, and exactly where it is not declared. */
    tolerance?: number;
    /** The observations that cover its changes, which an observable or partly observable member names and no other does. */
    observations?: DomqlObservationDeclaration[];
}

/** A predicate that `is` or `has` reads. */
export interface DomqlPredicateDeclaration {
    verb: 'is' | 'has';
    name: string;
    function: string;
    on: string | string[];
    changes: DomqlChangeCategory;
    reads: DomqlReadingMode;
    misses?: string;
    observations?: DomqlObservationDeclaration[];
}

/** What a module declares. */
export interface DomqlModuleContents {
    members?: DomqlMemberDeclaration[];
    /** The structured types it declares, each with its fields' types. */
    types?: { name: string; fields: Record<string, string> }[];
    /** The event types it declares, each with the type of its occurrences. */
    eventTypes?: { name: string; payload: string }[];
    predicates?: DomqlPredicateDeclaration[];
    /** The features `supports` names. */
    features?: string[];
    /** The types of observation it declares. */
    observationTypes?: DomqlObservationTypeDeclaration[];
}

/**
 * The functions that carry a module's members, predicates and observation types out, by the key each declaration names.
 * A member or a predicate takes its receiver, its arguments by name and the environment, and a member that reads maintained values also its samples, in the order its declaration names the observations.
 * A source takes its receiver, its arguments and the environment, and the function it delivers each occurrence to, and returns an object whose `stop` ends the listening.
 * An action takes its receiver, its arguments, the environment and `{ signal }`, and returns its result or a promise of it.
 * A behavior takes its receiver, its arguments, the environment and `{ reportError }`, starts before it returns, and returns an object whose `update(receiver, args)` applies new arguments and whose `dispose` ends it.
 * An observation type takes the request, the function it calls when something may have changed and the environment, and returns an object whose `stop` ends the observation and, for a maintained one, whose `sample` returns its latest sample.
 */
export type DomqlModuleFunctions = Record<string, (...args: any[]) => unknown>;

/** A vocabulary's members as data, and the functions that carry them out. */
export interface DomqlModule {
    readonly name: string;
    readonly members: readonly DomqlMemberDeclaration[];
    readonly functions: DomqlModuleFunctions | null;
}

export declare class Domql {
    /** The version of the specification this implementation follows, as major.minor.revision. */
    static readonly specificationVersion: string;

    /** Parses text into a query, binding its parameters. */
    static parse(text: string, bindings?: DomqlBindings): DomqlQuery;

    /** Creates a query from its definition, binding its parameters. */
    static create(definition: DomqlDefinition, bindings?: DomqlBindings): DomqlQuery;

    /** Binds a value with the type it has, for a value that reveals none, such as null or an empty list. */
    static bind(value: unknown, type: string): DomqlTypedBinding;

    /** Resolves a query given as its text against the registered vocabulary and types it, without evaluating anything. The text is parsed as `parse` parses it, through the same cache. */
    static resolve(text: string, bindings?: DomqlBindings, options?: DomqlResolveOptions): DomqlResolvedDefinition;

    /** Resolves a query against the registered vocabulary and types it, without evaluating anything. */
    static resolve(query: DomqlQuery, options?: DomqlResolveOptions): DomqlResolvedDefinition;

    /** Reads a query given as its text once, returning an immutable snapshot containing no live DOM references. A member maintained by an observation fails it. */
    static read<T = unknown>(text: string, bindings?: DomqlBindings, options?: DomqlReadOptions): T;

    /** Reads a query once, returning an immutable snapshot containing no live DOM references. A member maintained by an observation fails it. */
    static read<T = unknown>(query: DomqlQuery, options?: DomqlReadOptions): T;

    /** Reads a query given as its text once, waiting for the first sample of every maintained member it reads. Returns a promise of an immutable snapshot containing no live DOM references. */
    static readAsync<T = unknown>(text: string, bindings?: DomqlBindings, options?: DomqlReadAsyncOptions): Promise<T>;

    /** Reads a query once, waiting for the first sample of every maintained member it reads. Returns a promise of an immutable snapshot containing no live DOM references. */
    static readAsync<T = unknown>(query: DomqlQuery, options?: DomqlReadAsyncOptions): Promise<T>;

    /** Watches a query given as its text: reports its snapshot, and a snapshot that differs each time something it depends on changes. Pass `{}` as the bindings of a text that has none. */
    static watch<T = unknown>(text: string, bindings: DomqlBindings, configuration: DomqlWatchConfiguration<T>): DomqlWatch<T>;

    /** Watches a query given as its text, delivering a baseline and then the change sets between its snapshots. Pass `{}` as the bindings of a text that has none. */
    static watch<T = unknown>(text: string, bindings: DomqlBindings, configuration: DomqlWatchChangeSetConfiguration<T>): DomqlWatch<T>;

    /** Watches a query given as its text, keeping its result as live state: one object kept current in place. Pass `{}` as the bindings of a text that has none. */
    static watch<T = unknown>(text: string, bindings: DomqlBindings, configuration: DomqlWatchLiveStateConfiguration<T>): DomqlWatch<T>;

    /** Watches a query: reports its snapshot, and a snapshot that differs each time something it depends on changes. */
    static watch<T = unknown>(query: DomqlQuery, configuration: DomqlWatchConfiguration<T>): DomqlWatch<T>;

    /** Watches a query, delivering a baseline and then the change sets between its snapshots. */
    static watch<T = unknown>(query: DomqlQuery, configuration: DomqlWatchChangeSetConfiguration<T>): DomqlWatch<T>;

    /** Watches a query, keeping its result as live state: one object kept current in place. */
    static watch<T = unknown>(query: DomqlQuery, configuration: DomqlWatchLiveStateConfiguration<T>): DomqlWatch<T>;

    /** Subscribes to an event source given as its text and passes each projected result to `onEvent`. Listening starts in the call. Pass `{}` as the bindings of a text that has none. */
    static subscribe<T = unknown>(text: string, bindings: DomqlBindings, configuration: DomqlSubscribeConfiguration<T>): DomqlEventListener<T>;

    /** Subscribes to an event source and passes each projected result to `onEvent`. Listening starts in the call. */
    static subscribe<T = unknown>(query: DomqlQuery, configuration: DomqlSubscribeConfiguration<T>): DomqlEventListener<T>;

    /** Runs an action given as its text once, and returns a promise of its result, shaped by the shape that follows it where one does. A signal that aborts rejects with its reason; DOMQL never undoes what the action changed. */
    static runAsync<T = unknown>(text: string, bindings?: DomqlBindings, options?: DomqlRunAsyncOptions): Promise<T>;

    /** Runs an action once, and returns a promise of its result, shaped by the shape that follows it where one does. A signal that aborts rejects with its reason; DOMQL never undoes what the action changed. */
    static runAsync<T = unknown>(query: DomqlQuery, options?: DomqlRunAsyncOptions): Promise<T>;

    /** Activates a behavior given as its text, which is in effect once the call returns, and returns its handle. */
    static activate(text: string, bindings?: DomqlBindings, options?: DomqlActivateOptions): DomqlBehavior;

    /** Activates a behavior, which is in effect once the call returns, and returns its handle. */
    static activate(query: DomqlQuery, options?: DomqlActivateOptions): DomqlBehavior;

    /** Creates the current snapshot a watch's change sets build. */
    static createSnapshot<T = unknown>(): DomqlCurrentSnapshot<T>;

    /** Creates a module from the vocabulary it declares and the functions that carry the declarations out. */
    static createModule(name: string, contents: DomqlModuleContents, functions?: DomqlModuleFunctions | null): DomqlModule;

    /** Registers a module's vocabulary, which every query resolved afterwards may use. */
    static registerModule(module: DomqlModule): void;
}

