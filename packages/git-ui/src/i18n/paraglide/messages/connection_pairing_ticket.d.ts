/**
* | output |
* | --- |
* | "Pairing ticket" |
*
* @param {Connection_Pairing_TicketInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const connection_pairing_ticket: ((inputs?: Connection_Pairing_TicketInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Connection_Pairing_TicketInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Connection_Pairing_TicketInputs = {};
