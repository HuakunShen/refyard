/**
* | output |
* | --- |
* | "Clean and familiar" |
*
* @param {Settings_Interface_Web_DescInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_interface_web_desc: ((inputs?: Settings_Interface_Web_DescInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_Interface_Web_DescInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_Interface_Web_DescInputs = {};
