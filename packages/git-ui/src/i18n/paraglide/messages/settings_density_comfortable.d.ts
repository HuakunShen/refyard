/**
* | output |
* | --- |
* | "36px rows — the middle size" |
*
* @param {Settings_Density_ComfortableInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_density_comfortable: ((inputs?: Settings_Density_ComfortableInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_Density_ComfortableInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_Density_ComfortableInputs = {};
