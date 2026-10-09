const countQuery = Domql.parse('@panel.children.count', { panel });

Domql.readSync(countQuery);
// 3

const emptyPanel = document.createElement('div');
const rebound = Domql.create(countQuery.definition, { panel: emptyPanel });

Domql.readSync(rebound);
// 0
