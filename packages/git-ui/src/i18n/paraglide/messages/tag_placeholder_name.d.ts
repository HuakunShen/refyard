/**
* | output |
* | --- |
* | "v1.0.0" |
*
* @param {Tag_Placeholder_NameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const tag_placeholder_name: ((inputs?: Tag_Placeholder_NameInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Tag_Placeholder_NameInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Tag_Placeholder_NameInputs = {};
