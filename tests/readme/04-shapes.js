Domql.read(Domql.parse(`
    @panel {
        count: children.count,
        is "attached",
        has "children",
    }
`, { panel }));
// { count: 3, attached: true, children: true }
