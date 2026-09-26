/**
* | output |
* | --- |
* | "Expand repository panel" |
*
* @param {Panel_ExpandInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const panel_expand: ((inputs?: Panel_ExpandInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Panel_ExpandInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Panel_ExpandInputs = {};
