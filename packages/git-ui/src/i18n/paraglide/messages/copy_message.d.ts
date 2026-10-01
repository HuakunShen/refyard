/**
* | output |
* | --- |
* | "Copy Message" |
*
* @param {Copy_MessageInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_message: ((inputs?: Copy_MessageInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Copy_MessageInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Copy_MessageInputs = {};
