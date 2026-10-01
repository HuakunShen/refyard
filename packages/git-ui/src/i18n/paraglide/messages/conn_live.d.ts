/**
* | output |
* | --- |
* | "live updates" |
*
* @param {Conn_LiveInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conn_live: ((inputs?: Conn_LiveInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conn_LiveInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conn_LiveInputs = {};
