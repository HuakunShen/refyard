/**
* | output |
* | --- |
* | "Web" |
*
* @param {Settings_Interface_WebInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_interface_web: ((inputs?: Settings_Interface_WebInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_Interface_WebInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_Interface_WebInputs = {};
