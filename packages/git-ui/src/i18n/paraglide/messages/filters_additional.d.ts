/**
* | output |
* | --- |
* | "Additional history filters" |
*
* @param {Filters_AdditionalInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_additional: ((inputs?: Filters_AdditionalInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filters_AdditionalInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filters_AdditionalInputs = {};
