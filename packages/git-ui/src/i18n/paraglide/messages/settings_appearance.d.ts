/**
* | output |
* | --- |
* | "Appearance" |
*
* @param {Settings_AppearanceInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_appearance: ((inputs?: Settings_AppearanceInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_AppearanceInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_AppearanceInputs = {};
