const resolved = Domql.resolve(Domql.parse('@panel.children.count', {
    panel: Domql.bind(null, 'element?')
}));

resolved.kind;            // 'query'
resolved.type.toString(); // 'number?'
