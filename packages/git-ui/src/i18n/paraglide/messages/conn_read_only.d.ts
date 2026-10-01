/**
* | output |
* | --- |
* | "read-only (contract update available)" |
*
* @param {Conn_Read_OnlyInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conn_read_only: ((inputs?: Conn_Read_OnlyInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conn_Read_OnlyInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conn_Read_OnlyInputs = {};
