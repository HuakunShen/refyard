/**
* | output |
* | --- |
* | "Workspace" |
*
* @param {Launcher_WorkspaceInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_workspace: ((inputs?: Launcher_WorkspaceInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Launcher_WorkspaceInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Launcher_WorkspaceInputs = {};
