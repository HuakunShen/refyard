/**
* | output |
* | --- |
* | "{n} write operations" |
*
* @param {Header_N_Write_OpsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const header_n_write_ops: ((inputs: Header_N_Write_OpsInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Header_N_Write_OpsInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Header_N_Write_OpsInputs = {
    n: NonNullable<unknown>;
};
