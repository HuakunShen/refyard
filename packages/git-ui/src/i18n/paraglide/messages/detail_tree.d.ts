/**
* | output |
* | --- |
* | "tree" |
*
* @param {Detail_TreeInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const detail_tree: ((inputs?: Detail_TreeInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Detail_TreeInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Detail_TreeInputs = {};
