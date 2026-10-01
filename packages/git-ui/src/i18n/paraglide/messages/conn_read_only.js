/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Conn_Read_OnlyInputs */

const en_conn_read_only = /** @type {(inputs: Conn_Read_OnlyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`read-only (contract update available)`)
};

const zh_conn_read_only = /** @type {(inputs: Conn_Read_OnlyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`只读(有契约更新可用)`)
};

/**
* | output |
* | --- |
* | "read-only (contract update available)" |
*
* @param {Conn_Read_OnlyInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conn_read_only = /** @type {((inputs?: Conn_Read_OnlyInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conn_Read_OnlyInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conn_read_only(inputs)
	return en_conn_read_only(inputs)
});