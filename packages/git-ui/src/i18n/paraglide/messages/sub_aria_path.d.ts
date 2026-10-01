/**
* | output |
* | --- |
* | "submodule path" |
*
* @param {Sub_Aria_PathInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sub_aria_path: ((inputs?: Sub_Aria_PathInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Sub_Aria_PathInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Sub_Aria_PathInputs = {};
