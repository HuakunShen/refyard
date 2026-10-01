/**
* | output |
* | --- |
* | "Could not read this directory" |
*
* @param {Launcher_Read_Dir_ErrorInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_read_dir_error: ((inputs?: Launcher_Read_Dir_ErrorInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Launcher_Read_Dir_ErrorInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Launcher_Read_Dir_ErrorInputs = {};
