/**
* | output |
* | --- |
* | "Repository list height" |
*
* @param {Resize_Repo_ListInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const resize_repo_list: ((inputs?: Resize_Repo_ListInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Resize_Repo_ListInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Resize_Repo_ListInputs = {};
