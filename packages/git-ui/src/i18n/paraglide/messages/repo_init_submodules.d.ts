/**
* | output |
* | --- |
* | "Initialise submodules" |
*
* @param {Repo_Init_SubmodulesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_init_submodules: ((inputs?: Repo_Init_SubmodulesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Repo_Init_SubmodulesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Repo_Init_SubmodulesInputs = {};
