/**
* | output |
* | --- |
* | "Could not read submodules" |
*
* @param {Err_Read_SubmodulesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const err_read_submodules: ((inputs?: Err_Read_SubmodulesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Err_Read_SubmodulesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Err_Read_SubmodulesInputs = {};
