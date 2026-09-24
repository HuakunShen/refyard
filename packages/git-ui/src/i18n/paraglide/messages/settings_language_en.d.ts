/**
* | output |
* | --- |
* | "English" |
*
* @param {Settings_Language_EnInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_language_en: ((inputs?: Settings_Language_EnInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_Language_EnInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_Language_EnInputs = {};
