/**
* | output |
* | --- |
* | "macOS" |
*
* @param {Settings_Interface_MacosInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_interface_macos: ((inputs?: Settings_Interface_MacosInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_Interface_MacosInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_Interface_MacosInputs = {};
