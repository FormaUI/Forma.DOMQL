/**
 * BrowserModule — the built-in vocabulary with its browser reads and observations
 */

import { Vocabulary } from '../language/vocabulary/Vocabulary.mjs';
import { BrowserObservers } from './BrowserObservers.mjs';
import { VocabularyFunctions } from './VocabularyFunctions.mjs';

export class BrowserModule {
    /** The built-in module, whose members read the window and the document they are given and whose observation types start observations of them. */
    static create() {
        return Vocabulary.createModule({ ...VocabularyFunctions.functions, ...BrowserObservers.functions });
    }
}
