/**
* | output |
* | --- |
* | "System type · translucent chrome" |
*
* @param {Settings_Interface_Macos_DescInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_interface_macos_desc: ((inputs?: Settings_Interface_Macos_DescInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_Interface_Macos_DescInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_Interface_Macos_DescInputs = {};
