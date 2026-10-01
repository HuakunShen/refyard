/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Stash_ApplyInputs */

const en_stash_apply = /** @type {(inputs: Stash_ApplyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Apply`)
};

const zh_stash_apply = /** @type {(inputs: Stash_ApplyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`应用`)
};

/**
* | output |
* | --- |
* | "Apply" |
*
* @param {Stash_ApplyInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const stash_apply = /** @type {((inputs?: Stash_ApplyInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stash_ApplyInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_stash_apply(inputs)
	return en_stash_apply(inputs)
});