/**
* | output |
* | --- |
* | "Graph" |
*
* @param {History_Column_GraphInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_column_graph: ((inputs?: History_Column_GraphInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<History_Column_GraphInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type History_Column_GraphInputs = {};
