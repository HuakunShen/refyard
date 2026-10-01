/**
* | output |
* | --- |
* | "No old line" |
*
* @param {Split_No_OldInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const split_no_old: ((inputs?: Split_No_OldInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Split_No_OldInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Split_No_OldInputs = {};
