/**
* | output |
* | --- |
* | "Name" |
*
* @param {Remote_Name_LabelInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_name_label: ((inputs?: Remote_Name_LabelInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Remote_Name_LabelInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Remote_Name_LabelInputs = {};
