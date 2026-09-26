/**
* | output |
* | --- |
* | "44px rows — GitKraken's spacing" |
*
* @param {Settings_Density_RoomyInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_density_roomy: ((inputs?: Settings_Density_RoomyInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_Density_RoomyInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_Density_RoomyInputs = {};
