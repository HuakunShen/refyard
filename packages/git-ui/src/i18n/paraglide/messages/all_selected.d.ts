/**
* | output |
* | --- |
* | "All selected" |
*
* @param {All_SelectedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const all_selected: ((inputs?: All_SelectedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<All_SelectedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type All_SelectedInputs = {};
