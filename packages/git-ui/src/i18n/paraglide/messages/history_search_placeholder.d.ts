/**
* | output |
* | --- |
* | "Search commit messages…" |
*
* @param {History_Search_PlaceholderInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_search_placeholder: ((inputs?: History_Search_PlaceholderInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<History_Search_PlaceholderInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type History_Search_PlaceholderInputs = {};
