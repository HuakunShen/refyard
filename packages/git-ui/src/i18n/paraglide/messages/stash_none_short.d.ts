/**
* | output |
* | --- |
* | "No stashes." |
*
* @param {Stash_None_ShortInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const stash_none_short: ((inputs?: Stash_None_ShortInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Stash_None_ShortInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Stash_None_ShortInputs = {};
