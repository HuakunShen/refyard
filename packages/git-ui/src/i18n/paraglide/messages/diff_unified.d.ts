/**
* | output |
* | --- |
* | "Unified" |
*
* @param {Diff_UnifiedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const diff_unified: ((inputs?: Diff_UnifiedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Diff_UnifiedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Diff_UnifiedInputs = {};
