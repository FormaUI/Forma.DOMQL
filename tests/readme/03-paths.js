Domql.read(Domql.parse('@panel.children.count', { panel }));
// 3

Domql.read(Domql.parse('@panel.get("children.count")', { panel }));
// 3

Domql.read(Domql.parse('@panel is "attached"', { panel }));
// true
