/**
* | output |
* | --- |
* | "same origin" |
*
* @param {Same_OriginInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const same_origin: ((inputs?: Same_OriginInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Same_OriginInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Same_OriginInputs = {};
