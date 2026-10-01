/**
* | output |
* | --- |
* | "tag annotation" |
*
* @param {Tag_Aria_AnnotationInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const tag_aria_annotation: ((inputs?: Tag_Aria_AnnotationInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Tag_Aria_AnnotationInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Tag_Aria_AnnotationInputs = {};
