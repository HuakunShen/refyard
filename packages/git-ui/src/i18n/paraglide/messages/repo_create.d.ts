/**
* | output |
* | --- |
* | "Create repository" |
*
* @param {Repo_CreateInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_create: ((inputs?: Repo_CreateInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Repo_CreateInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Repo_CreateInputs = {};
