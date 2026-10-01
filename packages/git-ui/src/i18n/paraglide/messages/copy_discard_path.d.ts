/**
* | output |
* | --- |
* | "Discard path" |
*
* @param {Copy_Discard_PathInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_discard_path: ((inputs?: Copy_Discard_PathInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Copy_Discard_PathInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Copy_Discard_PathInputs = {};
