const clicks = Domql.subscribe(`
    @panel.eventsOf("click") {
        key: target.closest("[data-key]").attributeOf("data-key")
    }
`, { panel }, {
    onEvent: click => console.log(click.key)
});

panel.querySelector('[data-key="a2"]').click();
// 'a2'

clicks.dispose();
