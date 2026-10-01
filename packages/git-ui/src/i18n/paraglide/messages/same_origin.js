/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Same_OriginInputs */

const en_same_origin = /** @type {(inputs: Same_OriginInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`same origin`)
};

const zh_same_origin = /** @type {(inputs: Same_OriginInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`同源`)
};

/**
* | output |
* | --- |
* | "same origin" |
*
* @param {Same_OriginInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const same_origin = /** @type {((inputs?: Same_OriginInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Same_OriginInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_same_origin(inputs)
	return en_same_origin(inputs)
});