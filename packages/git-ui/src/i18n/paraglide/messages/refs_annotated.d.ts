/**
* | output |
* | --- |
* | "annotated" |
*
* @param {Refs_AnnotatedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const refs_annotated: ((inputs?: Refs_AnnotatedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Refs_AnnotatedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Refs_AnnotatedInputs = {};
