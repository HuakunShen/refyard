/**
* | output |
* | --- |
* | "Reading submodules…" |
*
* @param {Loading_SubmodulesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const loading_submodules: ((inputs?: Loading_SubmodulesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Loading_SubmodulesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Loading_SubmodulesInputs = {};
