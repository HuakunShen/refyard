/**
* | output |
* | --- |
* | "Could not read working copy" |
*
* @param {Err_Read_Working_CopyInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const err_read_working_copy: ((inputs?: Err_Read_Working_CopyInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Err_Read_Working_CopyInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Err_Read_Working_CopyInputs = {};
