/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Conn_No_LiveInputs */

const en_conn_no_live = /** @type {(inputs: Conn_No_LiveInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`no live updates`)
};

const zh_conn_no_live = /** @type {(inputs: Conn_No_LiveInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`无实时更新`)
};

/**
* | output |
* | --- |
* | "no live updates" |
*
* @param {Conn_No_LiveInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conn_no_live = /** @type {((inputs?: Conn_No_LiveInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conn_No_LiveInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conn_no_live(inputs)
	return en_conn_no_live(inputs)
});