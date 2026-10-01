/**
* | output |
* | --- |
* | "new branch name" |
*
* @param {Branch_New_Name_AriaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_new_name_aria: ((inputs?: Branch_New_Name_AriaInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Branch_New_Name_AriaInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Branch_New_Name_AriaInputs = {};
