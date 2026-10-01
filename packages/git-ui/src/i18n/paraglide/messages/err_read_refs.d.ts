/**
* | output |
* | --- |
* | "Could not read refs" |
*
* @param {Err_Read_RefsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const err_read_refs: ((inputs?: Err_Read_RefsInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Err_Read_RefsInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Err_Read_RefsInputs = {};
