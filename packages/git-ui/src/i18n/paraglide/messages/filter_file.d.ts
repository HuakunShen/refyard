/**
* | output |
* | --- |
* | "File: {name}" |
*
* @param {Filter_FileInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filter_file: ((inputs: Filter_FileInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filter_FileInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filter_FileInputs = {
    name: NonNullable<unknown>;
};
