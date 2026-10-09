/**
 * Vocabulary — the built-in vocabulary, as the specification's tables state it
 */

import { DomqlModule } from './DomqlModule.mjs';

/** A value parameter, required unless it is given a default. */
function value(name, type, options = {}) {
    const parameter = { name, kind: 'value', type, required: !('default' in options), fixed: false, nulls: 'propagate', ...options };

    if (parameter.fixed === false) {
        delete parameter.selects;
    }

    return parameter;
}

/** An expression parameter, evaluated against each item of the list it follows and producing the type. */
function expression(type) {
    return { name: 'expression', kind: 'expression', type, context: 'item', required: true, fixed: false, nulls: 'accept' };
}

/** A property or an operation. */
function member(kind, name, on, result, { builder = name, function: implementation = builder, parameters = [], changes = 'observable', reads = 'fresh', misses, observations } = {}) {
    const declaration = { name, builder, function: implementation, kind, on, parameters, result, changes, reads };

    if (observations !== undefined) {
        declaration.observations = observations;
    }

    if (implementation === null) {
        delete declaration.function;
    }

    if (misses !== undefined) {
        declaration.misses = misses;
    }

    return declaration;
}

const property = (name, on, result, options) => member('property', name, on, result, options);
const operation = (name, on, result, options) => member('operation', name, on, result, options);

/** A predicate the verb reads. */
function predicate(verb, name, on, { changes = 'observable', reads = 'fresh', misses, observations } = {}) {
    const declaration = { verb, name, function: `${verb}${name[0].toUpperCase()}${name.slice(1)}`, on, changes, reads };

    if (observations !== undefined) {
        declaration.observations = observations;
    }

    if (misses !== undefined) {
        declaration.misses = misses;
    }

    return declaration;
}

/** The observations the members share. */
const RESIZE = { type: 'resize', of: 'receiver' };
const WINDOW_RESIZE = { type: 'resize', of: 'window' };
const SCROLLING = { type: 'event', of: 'document', types: ['scroll'], capture: true };
const FOCUS = { type: 'event', of: 'document', types: ['focusin', 'focusout'] };
const ATTRIBUTES = { type: 'mutation', of: 'receiver', attributes: true };
const CHILDREN = { type: 'mutation', of: 'receiver', childList: true };
const STRUCTURE = { type: 'mutation', of: 'document', attributes: true, childList: true, subtree: true };
const TEXT_SELECTION = [
    { type: 'event', of: 'receiver', types: ['select', 'input'] },
    { type: 'event', of: 'document', types: ['selectionchange'] },
];

const SELECTOR = [value('selector', 'string')];
const MATCHING = { changes: 'partly-observable', misses: 'pointer state such as :hover and control state such as :checked' };
const GEOMETRY = { changes: 'partly-observable', misses: 'transforms and animations' };
const STYLE = { changes: 'partly-observable', misses: 'rules matching from elsewhere' };

export class Vocabulary {
    /**
     * The built-in module: its declarations and, where they are given, the functions that carry them out.
     * @param {Record<string, Function> | null} [functions] The functions the declarations name.
     */
    static createModule(functions = null) {
        return DomqlModule.createBuiltIn({
            types: [
                { name: 'size', fields: { width: 'number', height: 'number' } },
                { name: 'rectangle', fields: { left: 'number', top: 'number', right: 'number', bottom: 'number', width: 'number', height: 'number' } },
                { name: 'selection', fields: { start: 'number', end: 'number' } },
                { name: 'grid', fields: { columns: 'list<number>' } },
                { name: 'domEvent', fields: { target: 'element' } },
                { name: 'pointerEvent', fields: { target: 'element', button: 'number', buttons: 'number', clientX: 'number', clientY: 'number', pointerType: 'string' } },
                { name: 'keyboardEvent', fields: { target: 'element', key: 'string', code: 'string' } },
                { name: 'dragEvent', fields: { target: 'element', clientX: 'number', clientY: 'number' } },
            ],

            eventTypes: [
                { name: 'click', payload: 'pointerEvent' },
                { name: 'pointerdown', payload: 'pointerEvent' },
                { name: 'pointerup', payload: 'pointerEvent' },
                { name: 'keydown', payload: 'keyboardEvent' },
                { name: 'keyup', payload: 'keyboardEvent' },
                { name: 'drop', payload: 'dragEvent' },
                { name: 'focus', payload: 'domEvent' },
                { name: 'blur', payload: 'domEvent' },
                { name: 'input', payload: 'domEvent' },
                { name: 'scroll', payload: 'domEvent' },
                { name: 'resize', payload: 'domEvent' },
            ],

            features: ['share', 'clipboard'],

            observationTypes: [
                { name: 'resize', contract: 'invalidation', identity: ['box'], function: 'observeResize' },
                { name: 'mutation', contract: 'invalidation', identity: ['attributes', 'childList', 'subtree', 'characterData'], function: 'observeMutation' },
                { name: 'attachment', contract: 'invalidation', function: 'observeAttachment' },
                { name: 'intersection', contract: 'maintained', identity: ['root', 'margin'], function: 'observeIntersection' },
                { name: 'media', contract: 'invalidation', identity: ['query'], function: 'observeMedia' },
                { name: 'pixel-ratio', contract: 'invalidation', function: 'observePixelRatio' },
                { name: 'event', contract: 'invalidation', identity: ['types', 'capture'], function: 'observeEvents' },
                { name: 'visibility', contract: 'invalidation', function: 'observeVisibility' },
            ],

            predicates: [
                predicate('is', 'attached', 'element', { observations: [{ type: 'attachment', of: 'receiver' }] }),
                predicate('is', 'disabled', 'element', { observations: [{ type: 'mutation', of: 'document', attributes: ['disabled'], childList: true, subtree: true }] }),
                predicate('is', 'readOnly', 'element', { observations: [{ type: 'mutation', of: 'receiver', attributes: ['readonly', 'type'] }] }),
                predicate('is', 'textEditable', 'element', { changes: 'partly-observable', misses: 'the document\'s design mode', observations: [{ type: 'mutation', of: 'document', attributes: ['disabled', 'readonly', 'type', 'contenteditable', 'inert'], childList: true, subtree: true }] }),
                predicate('is', 'focused', 'element', { observations: [FOCUS] }),
                predicate('is', 'visible', 'document', { observations: [{ type: 'visibility', of: 'receiver' }] }),
                predicate('has', 'children', 'element', { observations: [CHILDREN] }),
                predicate('has', 'selection', 'element', { changes: 'partly-observable', misses: 'selections assigned by script', observations: TEXT_SELECTION }),
                predicate('has', 'focus', 'document', { observations: [{ type: 'event', of: 'window', types: ['focus', 'blur'] }] }),
            ],

            members: [
                property('size', 'window', 'size', { function: 'windowSize', observations: [WINDOW_RESIZE] }),
                property('devicePixelRatio', 'window', 'number', { observations: [{ type: 'pixel-ratio', of: 'window' }] }),
                property('rect', 'element', 'rectangle?', { ...GEOMETRY, parameters: [value('relativeTo', 'element', { default: null, omitted: 'the layout viewport' })], observations: [RESIZE, { type: 'resize', of: { argument: 'relativeTo' } }, SCROLLING, WINDOW_RESIZE] }),
                property('size', 'element', 'size?', { observations: [RESIZE] }),
                property('clientSize', 'element', 'size?', { observations: [RESIZE] }),
                property('grid', 'element', 'grid?', { ...STYLE, observations: [RESIZE, ATTRIBUTES] }),
                property('selection', 'element', 'selection?', { changes: 'partly-observable', misses: 'selections assigned by script', observations: TEXT_SELECTION }),
                property('children', 'element', 'list<element>', { observations: [CHILDREN] }),
                property('parent', 'element', 'element?', { observations: [{ type: 'mutation', of: 'document', childList: true, subtree: true }] }),
                property('count', 'list<T>', 'number', { changes: 'derived', reads: 'derived' }),
                property('first', 'list<T>', 'T?', { changes: 'derived', reads: 'derived' }),
                property('last', 'list<T>', 'T?', { changes: 'derived', reads: 'derived' }),

                operation('matches-media', 'window', 'boolean', { builder: 'matchesMedia', parameters: [value('query', 'string')], observations: [{ type: 'media', of: 'window', query: { argument: 'query' } }] }),
                operation('supports', 'window', 'boolean', { changes: 'constant', parameters: [value('feature', 'string', { fixed: true, selects: 'feature' })] }),
                operation('is', ['document', 'element'], 'boolean', { function: null, changes: 'derived', reads: 'derived', parameters: [value('predicate', 'string', { fixed: true, selects: 'predicate' })] }),
                operation('has', ['document', 'element'], 'boolean', { function: null, changes: 'derived', reads: 'derived', parameters: [value('predicate', 'string', { fixed: true, selects: 'predicate' })] }),
                operation('attribute-of', 'element', 'string?', { builder: 'attributeOf', parameters: [value('name', 'string')], observations: [{ type: 'mutation', of: 'receiver', attributes: [{ argument: 'name' }] }] }),
                operation('computedstyle-of', 'element', 'string?', { ...STYLE, builder: 'computedStyle', parameters: [value('property', 'string')], observations: [RESIZE, ATTRIBUTES] }),
                operation('intersects', 'element', 'boolean?', { reads: 'maintained', parameters: [value('root', 'element?', { default: null, nulls: 'accept', omitted: 'the window' }), value('margin', 'number', { default: 0 })], observations: [{ type: 'intersection', of: 'receiver', root: { argument: 'root' }, margin: { argument: 'margin' } }] }),
                operation('overlaps', 'element', 'boolean?', { ...GEOMETRY, parameters: [value('other', 'element'), value('margin', 'number', { default: 0 })], observations: [RESIZE, { type: 'resize', of: { argument: 'other' } }, SCROLLING, WINDOW_RESIZE] }),
                operation('matches', 'element', 'boolean?', { ...MATCHING, parameters: SELECTOR, observations: [STRUCTURE, FOCUS] }),
                operation('closest', 'element', 'element?', { ...MATCHING, parameters: SELECTOR, observations: [STRUCTURE, FOCUS] }),
                operation('first', 'element', 'element?', { ...MATCHING, function: 'firstMatching', parameters: SELECTOR, observations: [STRUCTURE, FOCUS] }),
                operation('all', 'element', 'list<element>', { ...MATCHING, parameters: SELECTOR, observations: [STRUCTURE, FOCUS] }),
                operation('get', 'any', '@selected', { function: null, changes: 'derived', reads: 'derived', parameters: [value('name', 'string', { fixed: true, selects: 'member' })] }),
                operation('at', 'list<T>', 'T?', { changes: 'derived', reads: 'derived', parameters: [value('index', 'number')] }),
                operation('max', 'list<T>', 'number?', { changes: 'derived', reads: 'derived', parameters: [expression('number?')] }),
                operation('min', 'list<T>', 'number?', { changes: 'derived', reads: 'derived', parameters: [expression('number?')] }),
                operation('sum', 'list<T>', 'number', { changes: 'derived', reads: 'derived', parameters: [expression('number?')] }),
                operation('where', 'list<T>', 'list<T>', { changes: 'derived', reads: 'derived', parameters: [expression('boolean?')] }),

                { ...operation('events-of', ['element', 'document', 'window'], 'occurrence<@selected>', { builder: 'eventsOf', changes: 'constant', reads: 'captured', parameters: [value('type', 'string', { fixed: true, selects: 'occurrence' })] }), kind: 'source' },
            ],
        }, functions);
    }

    /** The built-in module as its declarations alone, which is enough to resolve a query and carries nothing out. */
    static get module() {
        return Vocabulary.createModule();
    }
}
