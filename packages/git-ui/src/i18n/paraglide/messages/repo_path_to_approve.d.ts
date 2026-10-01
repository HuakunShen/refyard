/**
* | output |
* | --- |
* | "repository path to approve" |
*
* @param {Repo_Path_To_ApproveInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_path_to_approve: ((inputs?: Repo_Path_To_ApproveInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Repo_Path_To_ApproveInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Repo_Path_To_ApproveInputs = {};
