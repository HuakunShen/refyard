/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Writes_UnavailableInputs */

const en_writes_unavailable = /** @type {(inputs: Writes_UnavailableInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Write capabilities unavailable`)
};

const zh_writes_unavailable = /** @type {(inputs: Writes_UnavailableInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`写入能力不可用`)
};

/**
* | output |
* | --- |
* | "Write capabilities unavailable" |
*
* @param {Writes_UnavailableInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const writes_unavailable = /** @type {((inputs?: Writes_UnavailableInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Writes_UnavailableInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_writes_unavailable(inputs)
	return en_writes_unavailable(inputs)
});