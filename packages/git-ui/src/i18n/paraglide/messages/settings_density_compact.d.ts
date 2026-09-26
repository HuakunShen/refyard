/**
* | output |
* | --- |
* | "28px rows — the default, the most commits per screen" |
*
* @param {Settings_Density_CompactInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_density_compact: ((inputs?: Settings_Density_CompactInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_Density_CompactInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_Density_CompactInputs = {};
