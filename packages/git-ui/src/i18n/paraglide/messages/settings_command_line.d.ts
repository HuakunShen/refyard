/**
* | output |
* | --- |
* | "Command line" |
*
* @param {Settings_Command_LineInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_command_line: ((inputs?: Settings_Command_LineInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_Command_LineInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_Command_LineInputs = {};
