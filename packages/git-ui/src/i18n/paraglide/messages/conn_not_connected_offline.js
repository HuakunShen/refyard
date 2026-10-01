/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Conn_Not_Connected_OfflineInputs */

const en_conn_not_connected_offline = /** @type {(inputs: Conn_Not_Connected_OfflineInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`not connected (offline)`)
};

const zh_conn_not_connected_offline = /** @type {(inputs: Conn_Not_Connected_OfflineInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`未连接(离线)`)
};

/**
* | output |
* | --- |
* | "not connected (offline)" |
*
* @param {Conn_Not_Connected_OfflineInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conn_not_connected_offline = /** @type {((inputs?: Conn_Not_Connected_OfflineInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conn_Not_Connected_OfflineInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conn_not_connected_offline(inputs)
	return en_conn_not_connected_offline(inputs)
});