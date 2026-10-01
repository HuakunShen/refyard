/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Wip_UnavailableInputs */

const en_wip_unavailable = /** @type {(inputs: Wip_UnavailableInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Unavailable`)
};

const zh_wip_unavailable = /** @type {(inputs: Wip_UnavailableInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`不可用`)
};

/**
* | output |
* | --- |
* | "Unavailable" |
*
* @param {Wip_UnavailableInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const wip_unavailable = /** @type {((inputs?: Wip_UnavailableInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Wip_UnavailableInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_wip_unavailable(inputs)
	return en_wip_unavailable(inputs)
});