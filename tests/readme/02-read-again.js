const countQuery = Domql.parse('@panel.children.count', { panel });

Domql.read(countQuery);
// 3

const emptyPanel = document.createElement('div');
const rebound = Domql.create(countQuery.definition, { panel: emptyPanel });

Domql.read(rebound);
// 0
