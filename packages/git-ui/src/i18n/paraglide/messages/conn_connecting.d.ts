/**
* | output |
* | --- |
* | "connecting…" |
*
* @param {Conn_ConnectingInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conn_connecting: ((inputs?: Conn_ConnectingInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conn_ConnectingInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conn_ConnectingInputs = {};
