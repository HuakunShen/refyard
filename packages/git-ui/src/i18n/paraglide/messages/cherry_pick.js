/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Cherry_PickInputs */

const en_cherry_pick = /** @type {(inputs: Cherry_PickInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Cherry-pick`)
};

const zh_cherry_pick = /** @type {(inputs: Cherry_PickInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`摘取`)
};

/**
* | output |
* | --- |
* | "Cherry-pick" |
*
* @param {Cherry_PickInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const cherry_pick = /** @type {((inputs?: Cherry_PickInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Cherry_PickInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_cherry_pick(inputs)
	return en_cherry_pick(inputs)
});