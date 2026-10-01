/**
* | output |
* | --- |
* | "approved root" |
*
* @param {Repo_Approved_RootInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_approved_root: ((inputs?: Repo_Approved_RootInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Repo_Approved_RootInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Repo_Approved_RootInputs = {};
