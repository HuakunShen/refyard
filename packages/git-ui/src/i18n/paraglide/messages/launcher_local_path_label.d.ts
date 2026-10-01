/**
* | output |
* | --- |
* | "Local repository path" |
*
* @param {Launcher_Local_Path_LabelInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_local_path_label: ((inputs?: Launcher_Local_Path_LabelInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Launcher_Local_Path_LabelInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Launcher_Local_Path_LabelInputs = {};
