/**
* | output |
* | --- |
* | "No refs loaded." |
*
* @param {Common_No_RefsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_no_refs: ((inputs?: Common_No_RefsInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Common_No_RefsInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Common_No_RefsInputs = {};
