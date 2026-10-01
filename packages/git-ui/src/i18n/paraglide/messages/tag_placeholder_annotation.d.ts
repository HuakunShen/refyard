/**
* | output |
* | --- |
* | "annotation (empty = lightweight)" |
*
* @param {Tag_Placeholder_AnnotationInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const tag_placeholder_annotation: ((inputs?: Tag_Placeholder_AnnotationInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Tag_Placeholder_AnnotationInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Tag_Placeholder_AnnotationInputs = {};
