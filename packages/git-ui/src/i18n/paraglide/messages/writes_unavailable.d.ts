/**
* | output |
* | --- |
* | "Write capabilities unavailable" |
*
* @param {Writes_UnavailableInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const writes_unavailable: ((inputs?: Writes_UnavailableInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Writes_UnavailableInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Writes_UnavailableInputs = {};
