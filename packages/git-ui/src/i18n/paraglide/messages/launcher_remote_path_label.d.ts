/**
* | output |
* | --- |
* | "Remote repository path" |
*
* @param {Launcher_Remote_Path_LabelInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_remote_path_label: ((inputs?: Launcher_Remote_Path_LabelInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Launcher_Remote_Path_LabelInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Launcher_Remote_Path_LabelInputs = {};
