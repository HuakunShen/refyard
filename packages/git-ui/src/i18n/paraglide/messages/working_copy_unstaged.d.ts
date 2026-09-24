/**
* | output |
* | --- |
* | "Unstaged Files" |
*
* @param {Working_Copy_UnstagedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_unstaged: ((inputs?: Working_Copy_UnstagedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Working_Copy_UnstagedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Working_Copy_UnstagedInputs = {};
