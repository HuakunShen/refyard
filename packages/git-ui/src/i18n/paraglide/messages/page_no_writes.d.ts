/**
* | output |
* | --- |
* | "No write operations: no route, no capability, no button." |
*
* @param {Page_No_WritesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const page_no_writes: ((inputs?: Page_No_WritesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Page_No_WritesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Page_No_WritesInputs = {};
