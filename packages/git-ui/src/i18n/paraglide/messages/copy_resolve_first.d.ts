/**
* | output |
* | --- |
* | "Resolve conflicts first" |
*
* @param {Copy_Resolve_FirstInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_resolve_first: ((inputs?: Copy_Resolve_FirstInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Copy_Resolve_FirstInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Copy_Resolve_FirstInputs = {};
