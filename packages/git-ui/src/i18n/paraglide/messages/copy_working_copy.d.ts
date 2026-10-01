/**
* | output |
* | --- |
* | "Working copy" |
*
* @param {Copy_Working_CopyInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_working_copy: ((inputs?: Copy_Working_CopyInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Copy_Working_CopyInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Copy_Working_CopyInputs = {};
