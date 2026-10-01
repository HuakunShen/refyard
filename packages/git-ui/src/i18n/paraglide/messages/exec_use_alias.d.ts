/**
* | output |
* | --- |
* | "Use alias" |
*
* @param {Exec_Use_AliasInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const exec_use_alias: ((inputs?: Exec_Use_AliasInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Exec_Use_AliasInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Exec_Use_AliasInputs = {};
