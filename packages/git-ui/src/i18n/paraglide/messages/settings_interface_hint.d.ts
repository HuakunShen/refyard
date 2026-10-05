/**
* | output |
* | --- |
* | "Automatic follows your platform; any style works on any device." |
*
* @param {Settings_Interface_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_interface_hint: ((inputs?: Settings_Interface_HintInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_Interface_HintInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_Interface_HintInputs = {};
