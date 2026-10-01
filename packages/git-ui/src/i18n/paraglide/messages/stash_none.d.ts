/**
* | output |
* | --- |
* | "No stashes loaded." |
*
* @param {Stash_NoneInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const stash_none: ((inputs?: Stash_NoneInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Stash_NoneInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Stash_NoneInputs = {};
