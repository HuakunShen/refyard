/**
* | output |
* | --- |
* | "Solid Canvas" |
*
* @param {Bg_SolidInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const bg_solid: ((inputs?: Bg_SolidInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Bg_SolidInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Bg_SolidInputs = {};
