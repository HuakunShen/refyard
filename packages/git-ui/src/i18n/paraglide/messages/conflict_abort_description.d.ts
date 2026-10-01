/**
* | output |
* | --- |
* | "Restores the commit and index the operation started from." |
*
* @param {Conflict_Abort_DescriptionInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_abort_description: ((inputs?: Conflict_Abort_DescriptionInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conflict_Abort_DescriptionInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conflict_Abort_DescriptionInputs = {};
