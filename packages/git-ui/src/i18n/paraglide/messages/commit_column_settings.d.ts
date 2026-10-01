/**
* | output |
* | --- |
* | "Column settings" |
*
* @param {Commit_Column_SettingsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_column_settings: ((inputs?: Commit_Column_SettingsInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commit_Column_SettingsInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commit_Column_SettingsInputs = {};
