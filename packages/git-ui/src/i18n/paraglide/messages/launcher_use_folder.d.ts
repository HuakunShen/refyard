/**
* | output |
* | --- |
* | "Use this folder" |
*
* @param {Launcher_Use_FolderInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_use_folder: ((inputs?: Launcher_Use_FolderInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Launcher_Use_FolderInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Launcher_Use_FolderInputs = {};
