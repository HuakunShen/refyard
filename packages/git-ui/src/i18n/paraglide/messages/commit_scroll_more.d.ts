/**
* | output |
* | --- |
* | "Scroll for more" |
*
* @param {Commit_Scroll_MoreInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_scroll_more: ((inputs?: Commit_Scroll_MoreInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commit_Scroll_MoreInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commit_Scroll_MoreInputs = {};
