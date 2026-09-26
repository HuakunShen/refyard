/**
* | output |
* | --- |
* | "Collapse" |
*
* @param {Common_CollapseInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_collapse: ((inputs?: Common_CollapseInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Common_CollapseInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Common_CollapseInputs = {};
