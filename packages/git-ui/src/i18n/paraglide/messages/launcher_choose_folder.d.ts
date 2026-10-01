/**
* | output |
* | --- |
* | "Choose a repository folder" |
*
* @param {Launcher_Choose_FolderInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_choose_folder: ((inputs?: Launcher_Choose_FolderInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Launcher_Choose_FolderInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Launcher_Choose_FolderInputs = {};
