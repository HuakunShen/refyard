/**
* | output |
* | --- |
* | "Before" |
*
* @param {Split_BeforeInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const split_before: ((inputs?: Split_BeforeInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Split_BeforeInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Split_BeforeInputs = {};
