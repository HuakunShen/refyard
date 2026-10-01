/**
* | output |
* | --- |
* | "Ref" |
*
* @param {Filters_RefInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_ref: ((inputs?: Filters_RefInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filters_RefInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filters_RefInputs = {};
