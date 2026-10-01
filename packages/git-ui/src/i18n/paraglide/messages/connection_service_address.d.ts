/**
* | output |
* | --- |
* | "Service address" |
*
* @param {Connection_Service_AddressInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const connection_service_address: ((inputs?: Connection_Service_AddressInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Connection_Service_AddressInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Connection_Service_AddressInputs = {};
