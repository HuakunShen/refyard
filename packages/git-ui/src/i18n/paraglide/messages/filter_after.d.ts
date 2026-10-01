/**
* | output |
* | --- |
* | "After: {value}" |
*
* @param {Filter_AfterInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filter_after: ((inputs: Filter_AfterInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filter_AfterInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filter_AfterInputs = {
    value: NonNullable<unknown>;
};
