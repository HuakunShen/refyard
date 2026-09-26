/**
* | output |
* | --- |
* | "What changed, and why" |
*
* @param {Working_Copy_What_ChangedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_what_changed: ((inputs?: Working_Copy_What_ChangedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Working_Copy_What_ChangedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Working_Copy_What_ChangedInputs = {};
