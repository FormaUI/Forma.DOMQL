/**
 * The types of DOMQL's public API, shipped beside domql.js.
 */

/** How a query will be carried out, which resolution checks it against. */
export interface ResolveOptions {
    /** Whether the query will be watched. */
    watch?: boolean;
    /** Whether a watch accepts members whose changes its observations only partly cover. */
    acceptPartialObservation?: boolean;
}

/** What a read uses. */
export interface ReadOptions {
    /** The window `@window` stands for, and whose document `@document` stands for; by default the environment's. */
    window?: Window;
}

/** What a read that waits uses. */
export interface ReadAsyncOptions extends ReadOptions {
    /** Cancels the read, which then fails with the signal's reason. */
    signal?: AbortSignal;
}

/** How a query is watched. */
export interface WatchOptions<T = unknown> {
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
export interface ChangeSetWatchOptions<T = unknown> extends Omit<WatchOptions<T>, 'onChange' | 'updateStrategy'> {
    /** Delivers a baseline and then the change sets between snapshots, each sent once the one before it is acknowledged. */
    updateStrategy: 'changeSet';
    /** Receives each update, for the host to apply to a current snapshot; the host acknowledges one that applied, and recovers the watch where one failed or the snapshot was lost. */
    onChange: (update: SnapshotUpdate<T>) => unknown;
}

/** One operation of a change set: a JSON Patch operation limited to replace, add, remove and move, whose paths are JSON Pointers into the result. */
export type ChangeOperation =
    | { readonly op: 'replace' | 'add'; readonly path: string; readonly value: unknown }
    | { readonly op: 'remove'; readonly path: string }
    | { readonly op: 'move'; readonly from: string; readonly path: string };

/** The complete result that starts a generation of updates, at revision 0. */
export interface SnapshotBaseline<T = unknown> {
    readonly kind: 'baseline';
    readonly generation: number;
    readonly from: null;
    readonly to: 0;
    readonly snapshot: T;
}

/** The changes from one revision of a generation to the next, relative to the snapshot at the first. */
export interface SnapshotChangeSet {
    readonly kind: 'changeSet';
    readonly generation: number;
    readonly from: number;
    readonly to: number;
    readonly patch: readonly ChangeOperation[];
}

/** An update of a snapshot, whatever carries it: a baseline or a change set. */
export type SnapshotUpdate<T = unknown> = SnapshotBaseline<T> | SnapshotChangeSet;

/** The current snapshot a watch's change sets build on the receiving side. */
export interface DomqlCurrentSnapshot<T = unknown> {
    /** The snapshot last accepted, immutable; null before the first baseline. Applying an update advances it, and every snapshot read before stays unchanged. */
    readonly value: T | null;
    /** The generation of the baseline the state started from, or null before the first. */
    readonly generation: number | null;
    /** The revision of the state within its generation, or null before the first baseline. */
    readonly revision: number | null;
    /** Applies an update atomically: `accepted` where it applied, to acknowledge; `stale` where it belongs to an older generation or revision, which changes nothing; `failed` where it cannot apply, which leaves the snapshot as it was and asks for recovery. */
    apply(update: SnapshotUpdate<T>): 'accepted' | 'stale' | 'failed';
}

/** A watch: the handle of a query kept current. */
export interface DomqlWatch<T = unknown> {
    /** `pending` until the first snapshot is available, `ready` while the watch has a current one, `failed` after an evaluation fails, and `disposed` once it is ended. */
    readonly status: 'pending' | 'ready' | 'failed' | 'disposed';
    /** The snapshot last reported, null before the first and where the snapshot itself is null; read beside the status. */
    readonly lastSnapshot: T | null;
    /** Evaluates now, and settles once the evaluation has completed and the snapshot it produced, if it differs, has been handed to the callback. Rejects with the failure of its evaluation, resolves without delivering where disposal cancels it, and rejects after disposal. */
    refreshAsync(): Promise<void>;
    /** Ends the watch: cancels what it scheduled, disposes every observation session and prevents any new callback invocation. A callback already running may finish. */
    dispose(): void;
    /** Confirms that the receiver applied a delivery of a watch that delivers change sets, so the next change set is computed against the state it established; a delivery recovery abandoned changes nothing. A watch that delivers snapshots refuses it. */
    acknowledge(update: SnapshotUpdate<T>): void;
    /** Abandons the current generation of a watch that delivers change sets, and sends the current snapshot as a new baseline. A watch that delivers snapshots refuses it. */
    recover(): void;
}

/** A DOMQL definition: the JSON document that records a query's meaning, without the values its parameters are bound to. */
export interface Definition {
    readonly version: number;
    readonly query: DefinitionNode;
}

/** A node of a definition. */
export type DefinitionNode =
    | { readonly kind: 'literal'; readonly value: string | number | boolean | null }
    | { readonly kind: 'parameter'; readonly name: string }
    | { readonly kind: 'member'; readonly target?: DefinitionNode; readonly name: string; readonly arguments: readonly DefinitionEntry[] }
    | { readonly kind: 'shape'; readonly target?: DefinitionNode; readonly fields: readonly DefinitionEntry[] }
    | { readonly kind: 'predicate'; readonly verb: 'is' | 'has'; readonly target?: DefinitionNode; readonly test: PredicateNames };

/** The predicate names a test reads: a string, a parameter, or an and or an or of two or more of them. */
export type PredicateNames =
    | { readonly kind: 'literal'; readonly value: string }
    | { readonly kind: 'parameter'; readonly name: string }
    | { readonly kind: 'and' | 'or'; readonly operands: readonly PredicateNames[] };

/** An argument of a member or a field of a shape, with the name written for it, if any. */
export interface DefinitionEntry {
    readonly name?: string;
    readonly value: DefinitionNode;
}

/** A value bound with the type its caller declares for it, as `Domql.bind` answers. */
export interface TypedBinding {
    readonly value: unknown;
    /** The declared type, in DOMQL's type notation. */
    readonly type: string;
}

/** What a query's parameters are bound to. */
export interface ParameterValues {
    [name: string]: unknown | TypedBinding;
}

/** The values a query's parameters are bound to, by name. */
export interface ParameterBindings {
    has(name: string): boolean;
    get(name: string): unknown;
}

/** A DOMQL query: its definition and the values its parameters are bound to. */
export interface DomqlQuery {
    /** The query's definition, without its bound values. */
    readonly definition: Definition;
    readonly bindings: ParameterBindings;
}

/** A DOMQL type: a named type, a list, an occurrence source, a shape or a null, each nullable or not. */
export interface Type {
    readonly kind: 'named' | 'list' | 'occurrence' | 'shape' | 'variable' | 'null';
    readonly name: string | null;
    readonly item: Type | null;
    readonly fields: ReadonlyMap<string, Type> | null;
    readonly isNullable: boolean;
    /** The type in DOMQL's notation, such as `number?` or `list<element>`. */
    toString(): string;
}

/** A query resolved against the registered vocabulary. */
export interface ResolvedDefinition {
    readonly definition: Definition;
    /** The kind of request: a query, a subscription, an action or a behavior request. */
    readonly kind: 'query' | 'subscription' | 'action' | 'behavior';
    /** The type of the request's result. */
    readonly type: Type;
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
export type ChangeCategory = 'constant' | 'observable' | 'partly-observable' | 'unobserved' | 'derived';

/** How a member reads. */
export type ReadingMode = 'fresh' | 'maintained' | 'captured' | 'derived';

/** A reference to the argument a call gives for a parameter of the member. */
export interface ArgumentReference {
    argument: string;
}

/** A value an observation gives: a literal, a list of values, or an argument of the member. */
export type ObservationValue = string | number | boolean | null | ArgumentReference | ObservationValue[];

/** An observation that covers a member's changes: its type, what it observes, and the arguments its type takes. */
export interface ObservationDeclaration {
    /** The name of the type of observation, which a module declares. */
    type: string;
    /** What it observes: the receiver, the window, the document, or the argument of the member that names it. */
    of: 'receiver' | 'window' | 'document' | ArgumentReference;
    [argument: string]: ObservationValue | undefined;
}

/** A type of observation: what its observations provide, and the function that starts one. */
export interface ObservationTypeDeclaration {
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
export interface ParameterDeclaration {
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
export interface MemberDeclaration {
    /** The DOMQL name. */
    name: string;
    /** The key of the function that carries it out, among the module's functions. */
    function?: string;
    kind: 'property' | 'operation' | 'source' | 'action' | 'behavior';
    /** The types it applies to, in DOMQL's notation. */
    on: string | string[];
    parameters?: ParameterDeclaration[];
    /** The type of its result, in DOMQL's notation. */
    result: string;
    changes: ChangeCategory;
    reads: ReadingMode;
    /** The changes a partly observable member's observations miss. */
    misses?: string;
    /** How far a number it answers may move before a watch reports a different snapshot; the number must change by more, and exactly where it is not declared. */
    tolerance?: number;
    /** The observations that cover its changes, which an observable or partly observable member names and no other does. */
    observations?: ObservationDeclaration[];
}

/** A predicate that `is` or `has` reads. */
export interface PredicateDeclaration {
    verb: 'is' | 'has';
    name: string;
    function: string;
    on: string | string[];
    changes: ChangeCategory;
    reads: ReadingMode;
    misses?: string;
    observations?: ObservationDeclaration[];
}

/** What a module declares. */
export interface ModuleContents {
    members?: MemberDeclaration[];
    /** The structured types it declares, each with its fields' types. */
    types?: { name: string; fields: Record<string, string> }[];
    /** The event types it declares, each with the type of its occurrences. */
    eventTypes?: { name: string; payload: string }[];
    predicates?: PredicateDeclaration[];
    /** The features `supports` names. */
    features?: string[];
    /** The types of observation it declares. */
    observationTypes?: ObservationTypeDeclaration[];
}

/** The functions that carry a module's members and predicates out, by the key each declaration names. A member that reads maintained values is also given their samples, in the order its declaration names the observations. */
export type ModuleFunctions = Record<string, (receiver: any, args: Record<string, any>, environment: { window: Window; document: Document }, samples: readonly unknown[]) => unknown>;

/** A vocabulary's members as data, and the functions that carry them out. */
export interface DomqlModule {
    readonly name: string;
    readonly members: readonly MemberDeclaration[];
    readonly functions: ModuleFunctions | null;
}

export declare class Domql {
    /** The version of the specification this implementation follows, as major.minor.revision. */
    static readonly specificationVersion: string;

    /** Parses text into a query, binding its parameters. */
    static parse(text: string, bindings?: ParameterValues): DomqlQuery;

    /** Creates a query from its definition, binding its parameters. */
    static create(definition: Definition, bindings?: ParameterValues): DomqlQuery;

    /** Binds a value with the type it has, for a value that reveals none, such as null or an empty list. */
    static bind(value: unknown, type: string): TypedBinding;

    /** Resolves a query against the registered vocabulary and types it, without evaluating anything. */
    static resolve(query: DomqlQuery, options?: ResolveOptions): ResolvedDefinition;

    /** Reads a query once, answering immutable data that holds nothing of the document. A member maintained by an observation fails it. */
    static read<T = unknown>(query: DomqlQuery, options?: ReadOptions): T;

    /** Reads a query once, waiting for the first sample of every maintained member it reads, and answers immutable data that holds nothing of the document. */
    static readAsync<T = unknown>(query: DomqlQuery, options?: ReadAsyncOptions): Promise<T>;

    /** Watches a query: reports its snapshot, and a snapshot that differs each time something it depends on changes. */
    static watch<T = unknown>(query: DomqlQuery, options: WatchOptions<T>): DomqlWatch<T>;

    /** Watches a query, delivering a baseline and then the change sets between its snapshots. */
    static watch<T = unknown>(query: DomqlQuery, options: ChangeSetWatchOptions<T>): DomqlWatch<T>;

    /** Creates the current snapshot a watch's change sets build. */
    static createSnapshot<T = unknown>(): DomqlCurrentSnapshot<T>;

    /** Creates a module from the vocabulary it declares and the functions that carry the declarations out. */
    static createModule(name: string, contents: ModuleContents, functions?: ModuleFunctions | null): DomqlModule;

    /** Registers a module's vocabulary, which every query resolved afterwards may use. */
    static registerModule(module: DomqlModule): void;
}
