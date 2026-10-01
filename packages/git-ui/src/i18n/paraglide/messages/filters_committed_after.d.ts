/**
* | output |
* | --- |
* | "Committed after (UTC)" |
*
* @param {Filters_Committed_AfterInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_committed_after: ((inputs?: Filters_Committed_AfterInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filters_Committed_AfterInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filters_Committed_AfterInputs = {};
