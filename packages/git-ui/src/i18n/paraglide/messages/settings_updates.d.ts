/**
* | output |
* | --- |
* | "Updates" |
*
* @param {Settings_UpdatesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_updates: ((inputs?: Settings_UpdatesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_UpdatesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_UpdatesInputs = {};
