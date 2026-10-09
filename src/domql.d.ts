/**
 * The types of DOMQL's public API, shipped beside domql.js.
 */

/** How a query will be carried out, which resolution checks it against. */
export interface ResolveOptions {
    /** Whether the query will be watched. */
    watch?: boolean;
    /** Whether a watch accepts members whose changes its sources only partly observe. */
    acceptPartialObservation?: boolean;
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
    | { readonly kind: 'shape'; readonly target?: DefinitionNode; readonly fields: readonly DefinitionEntry[] };

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
    /** The type of the request's answer. */
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
    selects?: 'member' | 'predicate' | 'occurrence' | 'feature';
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
    /** The public builder name. */
    builder: string;
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
    /** The changes a partly observable member's sources miss. */
    misses?: string;
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
}

/** The functions that carry a module's members and predicates out, by the key each declaration names. */
export type ModuleFunctions = Record<string, (receiver: any, args: Record<string, any>, environment: { window: Window; document: Document }) => unknown>;

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

    /** Reads a query once, answering immutable data that holds nothing of the document. */
    static read<T = unknown>(query: DomqlQuery, window?: Window): T;

    /** Creates a module from the vocabulary it declares and the functions that carry the declarations out. */
    static createModule(name: string, contents: ModuleContents, functions?: ModuleFunctions | null): DomqlModule;

    /** Registers a module's vocabulary, which every query resolved afterwards may use. */
    static registerModule(module: DomqlModule): void;
}
