/**
* | output |
* | --- |
* | "Hosted service password" |
*
* @param {Connection_PasswordInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const connection_password: ((inputs?: Connection_PasswordInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Connection_PasswordInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Connection_PasswordInputs = {};
