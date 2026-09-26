/**
* | output |
* | --- |
* | "Background" |
*
* @param {Settings_BackgroundInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_background: ((inputs?: Settings_BackgroundInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_BackgroundInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_BackgroundInputs = {};
