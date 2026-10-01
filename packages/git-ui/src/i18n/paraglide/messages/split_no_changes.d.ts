/**
* | output |
* | --- |
* | "No line changes." |
*
* @param {Split_No_ChangesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const split_no_changes: ((inputs?: Split_No_ChangesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Split_No_ChangesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Split_No_ChangesInputs = {};
