/**
* | output |
* | --- |
* | "Compact Graph Column" |
*
* @param {Commit_Compact_GraphInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_compact_graph: ((inputs?: Commit_Compact_GraphInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commit_Compact_GraphInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commit_Compact_GraphInputs = {};
