/**
* | output |
* | --- |
* | "Drop for good" |
*
* @param {Stash_Drop_ForeverInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const stash_drop_forever: ((inputs?: Stash_Drop_ForeverInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Stash_Drop_ForeverInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Stash_Drop_ForeverInputs = {};
