/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Connection_Connect_LocalInputs */

const en_connection_connect_local = /** @type {(inputs: Connection_Connect_LocalInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Connect to the local service`)
};

const zh_connection_connect_local = /** @type {(inputs: Connection_Connect_LocalInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`连接本地服务`)
};

/**
* | output |
* | --- |
* | "Connect to the local service" |
*
* @param {Connection_Connect_LocalInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const connection_connect_local = /** @type {((inputs?: Connection_Connect_LocalInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Connection_Connect_LocalInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_connection_connect_local(inputs)
	return en_connection_connect_local(inputs)
});