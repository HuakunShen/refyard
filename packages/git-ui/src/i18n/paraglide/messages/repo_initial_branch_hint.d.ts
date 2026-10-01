/**
* | output |
* | --- |
* | "initial branch (optional: Git's default)" |
*
* @param {Repo_Initial_Branch_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_initial_branch_hint: ((inputs?: Repo_Initial_Branch_HintInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Repo_Initial_Branch_HintInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Repo_Initial_Branch_HintInputs = {};
