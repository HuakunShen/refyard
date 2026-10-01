/**
* | output |
* | --- |
* | "Selected file" |
*
* @param {Filter_Selected_FileInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filter_selected_file: ((inputs?: Filter_Selected_FileInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filter_Selected_FileInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filter_Selected_FileInputs = {};
