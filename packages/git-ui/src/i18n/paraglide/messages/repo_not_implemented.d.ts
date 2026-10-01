/**
* | output |
* | --- |
* | "not implemented in this build" |
*
* @param {Repo_Not_ImplementedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_not_implemented: ((inputs?: Repo_Not_ImplementedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Repo_Not_ImplementedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Repo_Not_ImplementedInputs = {};
