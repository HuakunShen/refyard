/**
* | output |
* | --- |
* | "Install `refyard` command" |
*
* @param {Settings_Command_Line_InstallInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_command_line_install: ((inputs?: Settings_Command_Line_InstallInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Settings_Command_Line_InstallInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Settings_Command_Line_InstallInputs = {};
