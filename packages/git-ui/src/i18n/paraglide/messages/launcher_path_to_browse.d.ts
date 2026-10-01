/**
* | output |
* | --- |
* | "Path to browse" |
*
* @param {Launcher_Path_To_BrowseInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_path_to_browse: ((inputs?: Launcher_Path_To_BrowseInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Launcher_Path_To_BrowseInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Launcher_Path_To_BrowseInputs = {};
