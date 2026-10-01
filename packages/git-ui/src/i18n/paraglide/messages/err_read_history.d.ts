/**
* | output |
* | --- |
* | "Could not read history" |
*
* @param {Err_Read_HistoryInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const err_read_history: ((inputs?: Err_Read_HistoryInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Err_Read_HistoryInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Err_Read_HistoryInputs = {};
