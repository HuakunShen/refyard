/**
* | output |
* | --- |
* | "Committed before (UTC)" |
*
* @param {Filters_Committed_BeforeInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_committed_before: ((inputs?: Filters_Committed_BeforeInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filters_Committed_BeforeInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filters_Committed_BeforeInputs = {};
