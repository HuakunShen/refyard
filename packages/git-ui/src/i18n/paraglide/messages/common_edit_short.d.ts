/**
* | output |
* | --- |
* | "Edit" |
*
* @param {Common_Edit_ShortInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_edit_short: ((inputs?: Common_Edit_ShortInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Common_Edit_ShortInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Common_Edit_ShortInputs = {};
