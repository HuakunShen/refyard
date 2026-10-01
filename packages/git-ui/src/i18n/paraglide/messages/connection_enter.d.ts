/**
* | output |
* | --- |
* | "Enter" |
*
* @param {Connection_EnterInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const connection_enter: ((inputs?: Connection_EnterInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Connection_EnterInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Connection_EnterInputs = {};
