Domql.readSync(Domql.parse('@panel.children.count', { panel }));
// 3

Domql.readSync(Domql.parse('@panel.get "children.count"', { panel }));
// 3

Domql.readSync(Domql.parse('@panel.is "attached"', { panel }));
// true
