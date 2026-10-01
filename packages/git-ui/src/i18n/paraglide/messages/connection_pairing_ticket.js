/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Connection_Pairing_TicketInputs */

const en_connection_pairing_ticket = /** @type {(inputs: Connection_Pairing_TicketInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Pairing ticket`)
};

const zh_connection_pairing_ticket = /** @type {(inputs: Connection_Pairing_TicketInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`配对票据`)
};

/**
* | output |
* | --- |
* | "Pairing ticket" |
*
* @param {Connection_Pairing_TicketInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const connection_pairing_ticket = /** @type {((inputs?: Connection_Pairing_TicketInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Connection_Pairing_TicketInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_connection_pairing_ticket(inputs)
	return en_connection_pairing_ticket(inputs)
});