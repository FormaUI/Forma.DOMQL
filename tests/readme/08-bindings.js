const optional = Domql.parse(`
    {
        panel: @panel { size },
        ids: @ids
    }
`, {
    panel: Domql.bind(null, 'element?'),
    ids: Domql.bind([], 'list<number>')
});

Domql.read(optional);
// { panel: null, ids: [] }
