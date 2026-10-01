/**
* | output |
* | --- |
* | "Unavailable" |
*
* @param {Wip_UnavailableInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const wip_unavailable: ((inputs?: Wip_UnavailableInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Wip_UnavailableInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Wip_UnavailableInputs = {};
