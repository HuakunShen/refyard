/**
* | output |
* | --- |
* | "Fetch URL" |
*
* @param {Remote_Fetch_UrlInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_fetch_url: ((inputs?: Remote_Fetch_UrlInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Remote_Fetch_UrlInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Remote_Fetch_UrlInputs = {};
