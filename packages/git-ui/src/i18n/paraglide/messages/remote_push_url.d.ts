/**
* | output |
* | --- |
* | "Push URL" |
*
* @param {Remote_Push_UrlInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_push_url: ((inputs?: Remote_Push_UrlInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Remote_Push_UrlInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Remote_Push_UrlInputs = {};
