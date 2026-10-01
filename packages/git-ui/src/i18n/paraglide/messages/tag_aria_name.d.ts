/**
* | output |
* | --- |
* | "tag name" |
*
* @param {Tag_Aria_NameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const tag_aria_name: ((inputs?: Tag_Aria_NameInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Tag_Aria_NameInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Tag_Aria_NameInputs = {};
