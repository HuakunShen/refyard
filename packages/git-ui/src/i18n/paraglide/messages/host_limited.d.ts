/**
* | output |
* | --- |
* | "The host limited this listing" |
*
* @param {Host_LimitedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const host_limited: ((inputs?: Host_LimitedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Host_LimitedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Host_LimitedInputs = {};
