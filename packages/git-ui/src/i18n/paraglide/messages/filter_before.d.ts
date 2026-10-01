/**
* | output |
* | --- |
* | "Before: {value}" |
*
* @param {Filter_BeforeInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filter_before: ((inputs: Filter_BeforeInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filter_BeforeInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filter_BeforeInputs = {
    value: NonNullable<unknown>;
};
