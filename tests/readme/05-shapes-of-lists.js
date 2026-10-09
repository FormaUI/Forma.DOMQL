Domql.read(Domql.parse(`
    @panel.all("[data-key]") {
        key: attribute-of "data-key",
        selected: matches "[aria-selected=true]"
    }
`, { panel }));
// [
//   { key: 'a1', selected: false },
//   { key: 'a2', selected: true },
//   { key: 'a3', selected: false }
// ]
