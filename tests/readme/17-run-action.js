Domql.registerModule(Domql.createModule('mark', {
    members: [{
        name: 'mark',
        function: 'mark',
        kind: 'action',
        on: 'element',
        parameters: [{ name: 'label', kind: 'value', type: 'string', required: true, nulls: 'propagate' }],
        result: 'boolean',
        changes: 'unobserved',
        reads: 'fresh'
    }]
}, {
    mark: (element, { label }) => {
        const changed = element.dataset.mark !== label;

        element.dataset.mark = label;

        return changed;
    }
}));

await Domql.runAsync('@panel.mark("reviewed")', { panel });
// true
