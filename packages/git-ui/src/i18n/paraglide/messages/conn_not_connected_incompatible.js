/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Conn_Not_Connected_IncompatibleInputs */

const en_conn_not_connected_incompatible = /** @type {(inputs: Conn_Not_Connected_IncompatibleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`not connected (incompatible service)`)
};

const zh_conn_not_connected_incompatible = /** @type {(inputs: Conn_Not_Connected_IncompatibleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`未连接(服务版本不兼容)`)
};

/**
* | output |
* | --- |
* | "not connected (incompatible service)" |
*
* @param {Conn_Not_Connected_IncompatibleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conn_not_connected_incompatible = /** @type {((inputs?: Conn_Not_Connected_IncompatibleInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conn_Not_Connected_IncompatibleInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conn_not_connected_incompatible(inputs)
	return en_conn_not_connected_incompatible(inputs)
});