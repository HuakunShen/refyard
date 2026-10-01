/**
* | output |
* | --- |
* | "Discard…" |
*
* @param {Copy_DiscardInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_discard: ((inputs?: Copy_DiscardInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Copy_DiscardInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Copy_DiscardInputs = {};
