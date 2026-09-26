/**
* | output |
* | --- |
* | "中文" |
*
* @param {Settings_Language_ZhInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_language_zh: ((inputs?: Settings_Language_ZhInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_Language_ZhInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_Language_ZhInputs = {};
