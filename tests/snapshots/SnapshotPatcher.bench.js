import { bench, describe } from 'vitest';
import { SnapshotPatcher } from '#domql/snapshots/SnapshotPatcher.mjs';

/** How many items a list holds. */
const ITEMS = 1000;

/** The elements the items were projected from, and each item, the same object in every order. */
const elements = Array.from({ length: ITEMS }, () => document.createElement('tr'));
const items = elements.map((_element, index) => Object.freeze({ key: `r${index}` }));

/** A list in the order the indices give, with the identities of its items. */
const listOf = order => [Object.freeze(order.map(index => items[index])), { elements: order.map(index => elements[index]), items: order.map(() => null) }];

/** The indices in their order. */
const ordered = Array.from({ length: ITEMS }, (_item, index) => index);

/** A shuffle a fixed seed repeats, so every run compares the same orders. */
const shuffled = () => {
    const order = [...ordered];
    let seed = 1;

    for (let index = order.length - 1; index > 0; index--) {
        seed = (seed * 16807) % 2147483647;

        const other = seed % (index + 1);

        [order[index], order[other]] = [order[other], order[index]];
    }

    return order;
};

/** Each order the list changes to, by how it changed. */
const reorders = {
    unchanged: ordered,
    'the first moved to the end': [...ordered.slice(1), 0],
    'the last moved to the start': [ITEMS - 1, ...ordered.slice(0, -1)],
    'two swapped': ordered.map(index => (index === 10 ? ITEMS - 10 : index === ITEMS - 10 ? 10 : index)),
    reversed: [...ordered].reverse(),
    shuffled: shuffled(),
};

describe(`the change set of ${ITEMS} items matched by element`, () => {
    const [previous, previousIdentities] = listOf(ordered);

    for (const [name, order] of Object.entries(reorders)) {
        const [next, nextIdentities] = listOf(order);

        bench(name, () => {
            SnapshotPatcher.between(previous, previousIdentities, next, nextIdentities);
        });
    }
});
