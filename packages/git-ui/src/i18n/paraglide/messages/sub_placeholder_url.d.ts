/**
* | output |
* | --- |
* | "remote URL (cloned when added)" |
*
* @param {Sub_Placeholder_UrlInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sub_placeholder_url: ((inputs?: Sub_Placeholder_UrlInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Sub_Placeholder_UrlInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Sub_Placeholder_UrlInputs = {};
