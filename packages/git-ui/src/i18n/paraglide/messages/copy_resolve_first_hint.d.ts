/**
* | output |
* | --- |
* | "Resolve and stage every conflicted file before committing." |
*
* @param {Copy_Resolve_First_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_resolve_first_hint: ((inputs?: Copy_Resolve_First_HintInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Copy_Resolve_First_HintInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Copy_Resolve_First_HintInputs = {};
