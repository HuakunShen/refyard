/**
* | output |
* | --- |
* | "Use valid UTC dates with the start no later than the end" |
*
* @param {Filter_Err_DatesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filter_err_dates: ((inputs?: Filter_Err_DatesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filter_Err_DatesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filter_Err_DatesInputs = {};
