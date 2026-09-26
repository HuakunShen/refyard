/**
* | output |
* | --- |
* | "Amend, keep message" |
*
* @param {Working_Copy_Amend_KeepInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_amend_keep: ((inputs?: Working_Copy_Amend_KeepInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Working_Copy_Amend_KeepInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Working_Copy_Amend_KeepInputs = {};
