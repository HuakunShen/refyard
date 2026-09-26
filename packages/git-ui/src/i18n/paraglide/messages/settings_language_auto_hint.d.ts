/**
* | output |
* | --- |
* | "Follow the browser" |
*
* @param {Settings_Language_Auto_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_language_auto_hint: ((inputs?: Settings_Language_Auto_HintInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_Language_Auto_HintInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_Language_Auto_HintInputs = {};
