/**
* | output |
* | --- |
* | "Expand Graph Column" |
*
* @param {Commit_Expand_GraphInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_expand_graph: ((inputs?: Commit_Expand_GraphInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commit_Expand_GraphInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commit_Expand_GraphInputs = {};
