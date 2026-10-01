/**
* | output |
* | --- |
* | "About & connection" |
*
* @param {Settings_About_ConnectionInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_about_connection: ((inputs?: Settings_About_ConnectionInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_About_ConnectionInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_About_ConnectionInputs = {};
