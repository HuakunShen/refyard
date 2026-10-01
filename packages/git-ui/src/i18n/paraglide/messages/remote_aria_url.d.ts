/**
* | output |
* | --- |
* | "remote url" |
*
* @param {Remote_Aria_UrlInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_aria_url: ((inputs?: Remote_Aria_UrlInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Remote_Aria_UrlInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Remote_Aria_UrlInputs = {};
