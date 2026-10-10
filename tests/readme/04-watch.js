const watch = Domql.watch(rebound, {
    onChange: count => console.log(count)
});

await watch.refreshAsync();
// 0

emptyPanel.append(document.createElement('div'));
await watch.refreshAsync();
// 1

watch.dispose();
