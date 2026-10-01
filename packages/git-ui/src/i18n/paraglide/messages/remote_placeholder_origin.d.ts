/**
* | output |
* | --- |
* | "origin" |
*
* @param {Remote_Placeholder_OriginInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_placeholder_origin: ((inputs?: Remote_Placeholder_OriginInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Remote_Placeholder_OriginInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Remote_Placeholder_OriginInputs = {};
