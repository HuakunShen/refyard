/**
* | output |
* | --- |
* | "Clone" |
*
* @param {Repo_CloneInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_clone: ((inputs?: Repo_CloneInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Repo_CloneInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Repo_CloneInputs = {};
