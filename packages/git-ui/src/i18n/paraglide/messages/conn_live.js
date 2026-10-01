/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Conn_LiveInputs */

const en_conn_live = /** @type {(inputs: Conn_LiveInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`live updates`)
};

const zh_conn_live = /** @type {(inputs: Conn_LiveInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`实时更新`)
};

/**
* | output |
* | --- |
* | "live updates" |
*
* @param {Conn_LiveInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conn_live = /** @type {((inputs?: Conn_LiveInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conn_LiveInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conn_live(inputs)
	return en_conn_live(inputs)
});