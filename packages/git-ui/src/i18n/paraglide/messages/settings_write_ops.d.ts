/**
* | output |
* | --- |
* | "Write operations" |
*
* @param {Settings_Write_OpsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_write_ops: ((inputs?: Settings_Write_OpsInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_Write_OpsInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_Write_OpsInputs = {};
