/**
* | output |
* | --- |
* | "Light" |
*
* @param {Mode_LightInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const mode_light: ((inputs?: Mode_LightInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Mode_LightInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Mode_LightInputs = {};
