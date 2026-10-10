const panel = document.getElementById('panel');

const query = Domql.parse(`
    @panel {
        count: children.count,
        items: all("[data-key]") {
            key: attributeOf "data-key",
            selected: matches "[aria-selected=true]"
        }
    }
`, { panel });

const snapshot = Domql.read(query);
// {
//   count: 3,
//   items: [
//     { key: 'a1', selected: false },
//     { key: 'a2', selected: true },
//     { key: 'a3', selected: false }
//   ]
// }
