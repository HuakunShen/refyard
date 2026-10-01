/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Conn_ConnectingInputs */

const en_conn_connecting = /** @type {(inputs: Conn_ConnectingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`connecting…`)
};

const zh_conn_connecting = /** @type {(inputs: Conn_ConnectingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`连接中…`)
};

/**
* | output |
* | --- |
* | "connecting…" |
*
* @param {Conn_ConnectingInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conn_connecting = /** @type {((inputs?: Conn_ConnectingInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conn_ConnectingInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conn_connecting(inputs)
	return en_conn_connecting(inputs)
});