/**
* | output |
* | --- |
* | "Could not read diff" |
*
* @param {Err_Read_DiffInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const err_read_diff: ((inputs?: Err_Read_DiffInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Err_Read_DiffInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Err_Read_DiffInputs = {};
