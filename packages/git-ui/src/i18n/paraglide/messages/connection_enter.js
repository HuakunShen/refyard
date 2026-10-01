/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Connection_EnterInputs */

const en_connection_enter = /** @type {(inputs: Connection_EnterInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Enter`)
};

const zh_connection_enter = /** @type {(inputs: Connection_EnterInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`输入`)
};

/**
* | output |
* | --- |
* | "Enter" |
*
* @param {Connection_EnterInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const connection_enter = /** @type {((inputs?: Connection_EnterInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Connection_EnterInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_connection_enter(inputs)
	return en_connection_enter(inputs)
});