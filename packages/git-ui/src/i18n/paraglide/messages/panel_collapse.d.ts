/**
* | output |
* | --- |
* | "Collapse repository panel" |
*
* @param {Panel_CollapseInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const panel_collapse: ((inputs?: Panel_CollapseInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Panel_CollapseInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Panel_CollapseInputs = {};
