/**
 * VocabularyFunctions — the functions that carry out the core vocabulary's members and answer its predicates
 */

/** The input types `readonly` applies to. */
const READ_ONLY_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'date', 'month', 'week', 'time', 'datetime-local', 'number']);

/** The input types that take text. */
const TEXT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);

/** The values of `contenteditable` that make content editable. */
const EDITABLE_VALUES = new Set(['', 'true', 'plaintext-only']);

export class VocabularyFunctions {
    /**
     * Each function takes the receiver, the arguments by parameter name, and the environment the request is read in.
     * @type {Record<string, (receiver: unknown, args: Record<string, any>, environment: { window: Window, document: Document }) => unknown>}
     */
    static get functions() {
        return {
            windowSize: window => {
                const root = window.document.documentElement;

                return { width: root.clientWidth, height: root.clientHeight };
            },
            devicePixelRatio: window => window.devicePixelRatio,
            rect: (element, { relativeTo }) => VocabularyFunctions.#rect(element, relativeTo),
            size: element => {
                const rect = VocabularyFunctions.#box(element);

                return rect === null ? null : { width: rect.width, height: rect.height };
            },
            clientSize: element => VocabularyFunctions.#hasBox(element) ? { width: element.clientWidth, height: element.clientHeight } : null,
            grid: element => VocabularyFunctions.#hasBox(element) ? { columns: VocabularyFunctions.#columns(element) } : null,
            selection: element => VocabularyFunctions.#selection(element),
            children: element => [...element.children],
            parent: element => element.parentElement,
            count: items => items.length,
            first: items => items.at(0) ?? null,
            last: items => items.at(-1) ?? null,

            matchesMedia: (window, { query }) => window.matchMedia(query).matches,
            supports: (window, { feature }) => VocabularyFunctions.#supports(window, feature),
            attributeOf: (element, { name }) => element.getAttribute(name),
            computedStyle: (element, { property }) => {
                if (!element.isConnected) {
                    return null;
                }

                const value = element.ownerDocument.defaultView.getComputedStyle(element).getPropertyValue(property).trim();

                return value === '' ? null : value;
            },
            intersects: () => VocabularyFunctions.#unavailable('it is maintained by an observation, and reading it waits for the first sample, which a synchronous evaluation cannot'),
            overlaps: (element, { other, margin }) => VocabularyFunctions.#overlaps(element, other, margin),
            matches: (element, { selector }) => element.matches(selector),
            closest: (element, { selector }) => element.closest(selector),
            firstMatching: (element, { selector }) => element.querySelector(selector),
            all: (element, { selector }) => [...element.querySelectorAll(selector)],
            at: (items, { index }) => Number.isInteger(index) && index >= 0 && index < items.length ? items[index] : null,
            max: (items, { expression }) => VocabularyFunctions.#extreme(items, expression, Math.max),
            min: (items, { expression }) => VocabularyFunctions.#extreme(items, expression, Math.min),
            sum: (items, { expression }) => VocabularyFunctions.#numbers(items, expression).reduce((total, number) => total + number, 0),
            where: (items, { expression }) => items.filter(item => expression(item) === true),
            eventsOf: () => VocabularyFunctions.#unavailable('it is an occurrence source, which is listened to and never read'),

            isAttached: element => element.isConnected,
            isDisabled: element => element.matches(':disabled'),
            isReadOnly: element => VocabularyFunctions.#isReadOnly(element),
            isTextEditable: element => VocabularyFunctions.#isTextEditable(element),
            isFocused: element => element.getRootNode().activeElement === element,
            isVisible: document => document.visibilityState === 'visible',
            hasChildren: element => element.childElementCount > 0,
            hasSelection: element => VocabularyFunctions.#hasSelection(element),
            hasFocus: document => document.hasFocus(),
        };
    }

    /** Fails the call of a member that cannot be read here, naming why. */
    static #unavailable(reason) {
        throw new Error(reason);
    }

    /** Whether the element has a layout box: it is attached and the browser generates a box for it, which it does not for `display: none` or `display: contents`. A box of no size is still a box. */
    static #hasBox(element) {
        return element.isConnected && element.getClientRects().length > 0;
    }

    /** The element's border box, or null where it has no layout box. */
    static #box(element) {
        return VocabularyFunctions.#hasBox(element) ? element.getBoundingClientRect() : null;
    }

    static #rect(element, relativeTo) {
        const box = VocabularyFunctions.#box(element);

        if (box === null) {
            return null;
        }

        const origin = relativeTo === null ? { left: 0, top: 0 } : VocabularyFunctions.#box(relativeTo);

        if (origin === null) {
            return null;
        }

        const left = box.left - origin.left;
        const top = box.top - origin.top;

        return { left, top, right: left + box.width, bottom: top + box.height, width: box.width, height: box.height };
    }

    static #overlaps(element, other, margin) {
        const first = VocabularyFunctions.#box(element);
        const second = VocabularyFunctions.#box(other);

        if (first === null || second === null) {
            return null;
        }

        return first.left - margin < second.right && second.left < first.right + margin && first.top - margin < second.bottom && second.top < first.bottom + margin;
    }

    /** The sizes of the element's grid column tracks, an empty list for an element that is no grid. */
    static #columns(element) {
        const style = element.ownerDocument.defaultView.getComputedStyle(element);

        if (!/grid/.test(style.display)) {
            return [];
        }

        return style.gridTemplateColumns.split(/\s+/).map(track => Number.parseFloat(track)).filter(size => Number.isFinite(size));
    }

    /** The start and end of the selection of a text input or text area, or null for any other element. */
    static #selection(element) {
        const start = VocabularyFunctions.#range(element);

        return start === null ? null : { start: start[0], end: start[1] };
    }

    static #range(element) {
        if (!VocabularyFunctions.#isTextControl(element)) {
            return null;
        }

        try {
            const { selectionStart, selectionEnd } = element;

            return selectionStart === null || selectionEnd === null ? null : [selectionStart, selectionEnd];
        } catch {
            return null;
        }
    }

    static #isTextControl(element) {
        return element.localName === 'textarea' || element.localName === 'input';
    }

    static #supports(window, feature) {
        return feature === 'share' ? typeof window.navigator.share === 'function' : window.navigator.clipboard !== undefined;
    }

    /** The largest or smallest of the numbers an expression produces, null where it produces none. */
    static #extreme(items, expression, choose) {
        const numbers = VocabularyFunctions.#numbers(items, expression);

        return numbers.length === 0 ? null : numbers.reduce((current, number) => choose(current, number));
    }

    /** The numbers an expression produces for the items, leaving out the items it produces null for. */
    static #numbers(items, expression) {
        return items.map(item => expression(item)).filter(number => number !== null);
    }

    static #isReadOnly(element) {
        if (element.localName === 'textarea') {
            return element.readOnly;
        }

        return element.localName === 'input' && READ_ONLY_TYPES.has(element.type) && element.readOnly;
    }

    static #isTextEditable(element) {
        if (element.closest('[inert]') !== null) {
            return false;
        }

        if (VocabularyFunctions.#isTextControl(element)) {
            const isText = element.localName === 'textarea' || TEXT_TYPES.has(element.type);

            return isText && !element.matches(':disabled') && !element.readOnly;
        }

        return VocabularyFunctions.#isContentEditable(element);
    }

    /** Whether the element's own or nearest ancestor's `contenteditable` makes its content editable, or the document's design mode does. */
    static #isContentEditable(element) {
        for (let current = element; current !== null; current = current.parentElement) {
            const value = current.getAttribute('contenteditable');

            if (value !== null && value.toLowerCase() !== 'inherit') {
                return EDITABLE_VALUES.has(value.toLowerCase());
            }
        }

        return element.ownerDocument.designMode === 'on';
    }

    static #hasSelection(element) {
        if (VocabularyFunctions.#isTextControl(element)) {
            const range = VocabularyFunctions.#range(element);

            return range !== null && range[0] !== range[1];
        }

        const selection = element.ownerDocument.defaultView.getSelection();

        return selection !== null && selection.rangeCount > 0 && !selection.isCollapsed && element.contains(selection.getRangeAt(0).commonAncestorContainer);
    }
}
