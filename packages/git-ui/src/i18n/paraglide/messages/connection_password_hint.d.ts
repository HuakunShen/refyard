/**
* | output |
* | --- |
* | "Enter the password configured on the CLI" |
*
* @param {Connection_Password_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const connection_password_hint: ((inputs?: Connection_Password_HintInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Connection_Password_HintInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Connection_Password_HintInputs = {};
