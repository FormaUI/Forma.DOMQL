/**
 * Vocabulary — DOMQL's core vocabulary, as the declarations the specification's tables state
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
function member(kind, name, on, result, { builder = name, function: implementation = builder, parameters = [], changes = 'observable', reads = 'fresh', misses } = {}) {
    const declaration = { name, builder, function: implementation, kind, on, parameters, result, changes, reads };

    if (misses !== undefined) {
        declaration.misses = misses;
    }

    return declaration;
}

const property = (name, on, result, options) => member('property', name, on, result, options);
const operation = (name, on, result, options) => member('operation', name, on, result, options);

/** A predicate the verb reads. */
function predicate(verb, name, on, { changes = 'observable', reads = 'fresh', misses } = {}) {
    const declaration = { verb, name, on, changes, reads };

    if (misses !== undefined) {
        declaration.misses = misses;
    }

    return declaration;
}

const SELECTOR = [value('selector', 'string')];
const MATCHING = { changes: 'partly-observable', misses: 'pointer state such as :hover and control state such as :checked' };
const GEOMETRY = { changes: 'partly-observable', misses: 'transforms and animations' };
const STYLE = { changes: 'partly-observable', misses: 'rules matching from elsewhere' };

export class Vocabulary {
    /** The core vocabulary's module. */
    static get module() {
        return DomqlModule.core({
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

            events: [
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

            predicates: [
                predicate('is', 'attached', 'element'),
                predicate('is', 'disabled', 'element'),
                predicate('is', 'readOnly', 'element'),
                predicate('is', 'textEditable', 'element', { changes: 'partly-observable', misses: 'the document\'s design mode' }),
                predicate('is', 'focused', 'element'),
                predicate('is', 'visible', 'document'),
                predicate('has', 'children', 'element'),
                predicate('has', 'selection', 'element', { changes: 'partly-observable', misses: 'selections assigned by script' }),
                predicate('has', 'focus', 'document'),
            ],

            declarations: [
                property('size', 'window', 'size', { function: 'windowSize' }),
                property('devicePixelRatio', 'window', 'number'),
                property('rect', 'element', 'rectangle?', { ...GEOMETRY, parameters: [value('relativeTo', 'element', { default: null, omitted: 'the layout viewport' })] }),
                property('size', 'element', 'size?'),
                property('clientSize', 'element', 'size?'),
                property('grid', 'element', 'grid', STYLE),
                property('selection', 'element', 'selection?', { changes: 'partly-observable', misses: 'selections assigned by script' }),
                property('children', 'element', 'list<element>'),
                property('parent', 'element', 'element?'),
                property('count', 'list<T>', 'number', { changes: 'derived', reads: 'derived' }),
                property('first', 'list<T>', 'T?', { changes: 'derived', reads: 'derived' }),
                property('last', 'list<T>', 'T?', { changes: 'derived', reads: 'derived' }),

                operation('matches-media', 'window', 'boolean', { builder: 'matchesMedia', parameters: [value('query', 'string')] }),
                operation('supports', 'window', 'boolean', { changes: 'constant', parameters: [value('feature', 'string', { fixed: true, selects: 'feature' })] }),
                operation('is', ['document', 'element'], 'boolean', { changes: 'derived', reads: 'derived', parameters: [value('predicate', 'string', { fixed: true, selects: 'predicate' })] }),
                operation('has', ['document', 'element'], 'boolean', { changes: 'derived', reads: 'derived', parameters: [value('predicate', 'string', { fixed: true, selects: 'predicate' })] }),
                operation('attribute-of', 'element', 'string?', { builder: 'attributeOf', parameters: [value('name', 'string')] }),
                operation('computedstyle-of', 'element', 'string?', { ...STYLE, builder: 'computedStyle', parameters: [value('property', 'string')] }),
                operation('intersects', 'element', 'boolean?', { reads: 'maintained', parameters: [value('root', 'element?', { default: null, nulls: 'accept', omitted: 'the window' }), value('margin', 'number', { default: 0 })] }),
                operation('overlaps', 'element', 'boolean?', { ...GEOMETRY, parameters: [value('other', 'element'), value('margin', 'number', { default: 0 })] }),
                operation('matches', 'element', 'boolean?', { ...MATCHING, parameters: SELECTOR }),
                operation('closest', 'element', 'element?', { ...MATCHING, parameters: SELECTOR }),
                operation('first', 'element', 'element?', { ...MATCHING, function: 'firstMatching', parameters: SELECTOR }),
                operation('all', 'element', 'list<element>', { ...MATCHING, parameters: SELECTOR }),
                operation('get', 'any', '@selected', { changes: 'derived', reads: 'derived', parameters: [value('name', 'string', { fixed: true, selects: 'member' })] }),
                operation('at', 'list<T>', 'T?', { changes: 'derived', reads: 'derived', parameters: [value('index', 'number')] }),
                operation('max', 'list<T>', 'number?', { changes: 'derived', reads: 'derived', parameters: [expression('number?')] }),
                operation('min', 'list<T>', 'number?', { changes: 'derived', reads: 'derived', parameters: [expression('number?')] }),
                operation('sum', 'list<T>', 'number', { changes: 'derived', reads: 'derived', parameters: [expression('number?')] }),
                operation('where', 'list<T>', 'list<T>', { changes: 'derived', reads: 'derived', parameters: [expression('boolean?')] }),

                { ...operation('events-of', ['element', 'document', 'window'], 'occurrence<@selected>', { builder: 'eventsOf', changes: 'constant', reads: 'captured', parameters: [value('type', 'string', { fixed: true, selects: 'occurrence' })] }), kind: 'source' },
            ],
        });
    }
}
