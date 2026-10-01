/**
* | output |
* | --- |
* | "Author" |
*
* @param {Filter_Field_AuthorInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filter_field_author: ((inputs?: Filter_Field_AuthorInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filter_Field_AuthorInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filter_Field_AuthorInputs = {};
