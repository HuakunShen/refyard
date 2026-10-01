/**
* | output |
* | --- |
* | "uncommitted changes — click to work on them" |
*
* @param {Copy_Uncommitted_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_uncommitted_hint: ((inputs?: Copy_Uncommitted_HintInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Copy_Uncommitted_HintInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Copy_Uncommitted_HintInputs = {};
