/**
* | output |
* | --- |
* | "Known file" |
*
* @param {Filters_Known_FileInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_known_file: ((inputs?: Filters_Known_FileInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filters_Known_FileInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filters_Known_FileInputs = {};
