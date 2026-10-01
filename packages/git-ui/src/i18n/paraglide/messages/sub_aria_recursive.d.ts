/**
* | output |
* | --- |
* | "submodule recursive" |
*
* @param {Sub_Aria_RecursiveInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sub_aria_recursive: ((inputs?: Sub_Aria_RecursiveInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Sub_Aria_RecursiveInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Sub_Aria_RecursiveInputs = {};
