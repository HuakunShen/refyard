/**
* | output |
* | --- |
* | "gone" |
*
* @param {Refs_GoneInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const refs_gone: ((inputs?: Refs_GoneInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Refs_GoneInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Refs_GoneInputs = {};
