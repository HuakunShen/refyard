/**
* | output |
* | --- |
* | "Copy Tag Name" |
*
* @param {Copy_Tag_NameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_tag_name: ((inputs?: Copy_Tag_NameInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Copy_Tag_NameInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Copy_Tag_NameInputs = {};
