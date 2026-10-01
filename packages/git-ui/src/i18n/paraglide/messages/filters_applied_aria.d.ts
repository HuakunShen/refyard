/**
* | output |
* | --- |
* | "Applied history filters" |
*
* @param {Filters_Applied_AriaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_applied_aria: ((inputs?: Filters_Applied_AriaInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filters_Applied_AriaInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filters_Applied_AriaInputs = {};
