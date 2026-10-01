/**
* | output |
* | --- |
* | "Annotation (optional)" |
*
* @param {Commitref_AnnotationInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commitref_annotation: ((inputs?: Commitref_AnnotationInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commitref_AnnotationInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commitref_AnnotationInputs = {};
