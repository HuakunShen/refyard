/**
* | output |
* | --- |
* | "No stash to pop" |
*
* @param {Toolbar_Pop_None_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_pop_none_title: ((inputs?: Toolbar_Pop_None_TitleInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Toolbar_Pop_None_TitleInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Toolbar_Pop_None_TitleInputs = {};
