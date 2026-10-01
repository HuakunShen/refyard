/**
* | output |
* | --- |
* | "Working tree is clean." |
*
* @param {Working_Copy_CleanInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_clean: ((inputs?: Working_Copy_CleanInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Working_Copy_CleanInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Working_Copy_CleanInputs = {};
