/**
* | output |
* | --- |
* | "what to create" |
*
* @param {Repo_What_To_CreateInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_what_to_create: ((inputs?: Repo_What_To_CreateInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Repo_What_To_CreateInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Repo_What_To_CreateInputs = {};
