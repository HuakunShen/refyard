/**
* | output |
* | --- |
* | "All refs" |
*
* @param {Filters_All_RefsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_all_refs: ((inputs?: Filters_All_RefsInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filters_All_RefsInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filters_All_RefsInputs = {};
