/**
* | output |
* | --- |
* | "Pop stash" |
*
* @param {Toolbar_Pop_StashInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_pop_stash: ((inputs?: Toolbar_Pop_StashInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Toolbar_Pop_StashInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Toolbar_Pop_StashInputs = {};
