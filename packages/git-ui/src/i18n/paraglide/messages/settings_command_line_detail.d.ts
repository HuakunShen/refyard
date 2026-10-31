/**
* | output |
* | --- |
* | "Install a `refyard` command so `refyard .` in a terminal opens that directory here." |
*
* @param {Settings_Command_Line_DetailInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_command_line_detail: ((inputs?: Settings_Command_Line_DetailInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_Command_Line_DetailInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_Command_Line_DetailInputs = {};
