/**
* | output |
* | --- |
* | "Stash" |
*
* @param {Stash_StashInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const stash_stash: ((inputs?: Stash_StashInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Stash_StashInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Stash_StashInputs = {};
