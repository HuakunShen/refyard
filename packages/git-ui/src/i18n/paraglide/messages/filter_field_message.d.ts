/**
* | output |
* | --- |
* | "Message" |
*
* @param {Filter_Field_MessageInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filter_field_message: ((inputs?: Filter_Field_MessageInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filter_Field_MessageInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filter_Field_MessageInputs = {};
