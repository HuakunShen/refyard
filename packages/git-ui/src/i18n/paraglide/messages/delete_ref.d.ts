/**
* | output |
* | --- |
* | "Delete ref" |
*
* @param {Delete_RefInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const delete_ref: ((inputs?: Delete_RefInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Delete_RefInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Delete_RefInputs = {};
