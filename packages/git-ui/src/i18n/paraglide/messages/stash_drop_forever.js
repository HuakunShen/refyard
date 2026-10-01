/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Stash_Drop_ForeverInputs */

const en_stash_drop_forever = /** @type {(inputs: Stash_Drop_ForeverInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Drop for good`)
};

const zh_stash_drop_forever = /** @type {(inputs: Stash_Drop_ForeverInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`彻底丢弃`)
};

/**
* | output |
* | --- |
* | "Drop for good" |
*
* @param {Stash_Drop_ForeverInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const stash_drop_forever = /** @type {((inputs?: Stash_Drop_ForeverInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stash_Drop_ForeverInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_stash_drop_forever(inputs)
	return en_stash_drop_forever(inputs)
});