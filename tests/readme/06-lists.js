Domql.readSync(Domql.parse(`
    @panel.all("[data-key]")
        .where(matches "[aria-selected=true]")
        .count
`, { panel }));
// 1

Domql.readSync(Domql.parse('@panel.all("[data-key]").max(rect.height)', { panel }));
// 64
