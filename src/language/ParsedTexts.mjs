/**
 * ParsedTexts — the definitions of the query texts parsed most recently
 */

import { DefinitionValidator } from './DefinitionValidator.mjs';
import { Parser } from './Parser.mjs';
import { TextLocations } from './TextLocations.mjs';

/** The most texts whose definitions are kept. */
const CAPACITY = 256;

export class ParsedTexts {
    /** Each kept text's definition, the least recently parsed first. @type {Map<string, object>} */
    static #definitions = new Map();

    /** @type {WeakMap<object, TextLocations>} */
    static #locations = new WeakMap();

    /** Where in its text each part of the parsed definition came from, or null for a definition not parsed from text. */
    static locationsOf(definition) {
        return ParsedTexts.#locations.get(definition) ?? null;
    }

    /** The validated, frozen definition the text parses into, kept for the next parse of the same text. */
    static parse(text) {
        const kept = ParsedTexts.#definitions.get(text);

        if (kept) {
            ParsedTexts.#definitions.delete(text);
            ParsedTexts.#definitions.set(text, kept);

            return kept;
        }

        const { definition, spans } = new Parser(text).parse();
        const locations = new TextLocations(text, definition, spans);
        const validated = new DefinitionValidator(locations).validate(definition);

        ParsedTexts.#locations.set(validated, locations);

        ParsedTexts.#definitions.set(text, validated);

        if (ParsedTexts.#definitions.size > CAPACITY) {
            ParsedTexts.#definitions.delete(ParsedTexts.#definitions.keys().next().value);
        }

        return validated;
    }
}
