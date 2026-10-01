/**
* | output |
* | --- |
* | "no live updates" |
*
* @param {Conn_No_LiveInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conn_no_live: ((inputs?: Conn_No_LiveInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conn_No_LiveInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conn_No_LiveInputs = {};
