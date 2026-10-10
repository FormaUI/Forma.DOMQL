const selected = Domql.build(q => q
    .from(panel)
    .all('[data-key]')
    .where(item => item.matches('[aria-selected=true]'))
    .select(item => ({ key: item.attributeOf('data-key') })));

Domql.read(selected);
// [ { key: 'a2' } ]
