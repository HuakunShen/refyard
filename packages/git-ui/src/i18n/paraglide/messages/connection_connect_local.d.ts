/**
* | output |
* | --- |
* | "Connect to the local service" |
*
* @param {Connection_Connect_LocalInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const connection_connect_local: ((inputs?: Connection_Connect_LocalInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Connection_Connect_LocalInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Connection_Connect_LocalInputs = {};
