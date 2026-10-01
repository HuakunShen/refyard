/**
* | output |
* | --- |
* | "Could not open the folder picker" |
*
* @param {Launcher_Picker_ErrorInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_picker_error: ((inputs?: Launcher_Picker_ErrorInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Launcher_Picker_ErrorInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Launcher_Picker_ErrorInputs = {};
