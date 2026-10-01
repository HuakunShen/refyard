/**
* | output |
* | --- |
* | "{field} must be a single line of up to 512 characters" |
*
* @param {Filter_Err_LineInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filter_err_line: ((inputs: Filter_Err_LineInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filter_Err_LineInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filter_Err_LineInputs = {
    field: NonNullable<unknown>;
};
