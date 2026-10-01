/**
* | output |
* | --- |
* | "No tags." |
*
* @param {Tag_None_ShortInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const tag_none_short: ((inputs?: Tag_None_ShortInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Tag_None_ShortInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Tag_None_ShortInputs = {};
