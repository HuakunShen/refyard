/**
* | output |
* | --- |
* | "No new line" |
*
* @param {Split_No_NewInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const split_no_new: ((inputs?: Split_No_NewInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Split_No_NewInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Split_No_NewInputs = {};
