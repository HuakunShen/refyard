/**
* | output |
* | --- |
* | "Restore this tracked path to the index version. Refyard writes a recovery backup before changing the working tree." |
*
* @param {Copy_Discard_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_discard_hint: ((inputs?: Copy_Discard_HintInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Copy_Discard_HintInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Copy_Discard_HintInputs = {};
