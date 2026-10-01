/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Connection_Service_AddressInputs */

const en_connection_service_address = /** @type {(inputs: Connection_Service_AddressInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Service address`)
};

const zh_connection_service_address = /** @type {(inputs: Connection_Service_AddressInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`服务地址`)
};

/**
* | output |
* | --- |
* | "Service address" |
*
* @param {Connection_Service_AddressInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const connection_service_address = /** @type {((inputs?: Connection_Service_AddressInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Connection_Service_AddressInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_connection_service_address(inputs)
	return en_connection_service_address(inputs)
});