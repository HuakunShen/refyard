/**
* | output |
* | --- |
* | "Mountain Mist" |
*
* @param {Bg_MistInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const bg_mist: ((inputs?: Bg_MistInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Bg_MistInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Bg_MistInputs = {};
