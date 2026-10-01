/**
* | output |
* | --- |
* | "Drop the folder to open it as a repository" |
*
* @param {Launcher_Drop_FolderInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_drop_folder: ((inputs?: Launcher_Drop_FolderInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Launcher_Drop_FolderInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Launcher_Drop_FolderInputs = {};
