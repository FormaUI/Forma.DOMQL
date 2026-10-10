const live = Domql.watch('{ count: @panel.children.count }', { panel: emptyPanel }, {
    updateStrategy: 'liveState',
    onChange: state => console.log(state.count)
});

await live.refreshAsync();
// 1

emptyPanel.append(document.createElement('div'));
await live.refreshAsync();
// 2

live.dispose();
