/**
* | output |
* | --- |
* | "Create new" |
*
* @param {Repo_Create_NewInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_create_new: ((inputs?: Repo_Create_NewInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Repo_Create_NewInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Repo_Create_NewInputs = {};
