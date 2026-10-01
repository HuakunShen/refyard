/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Stash_NoneInputs */

const en_stash_none = /** @type {(inputs: Stash_NoneInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No stashes loaded.`)
};

const zh_stash_none = /** @type {(inputs: Stash_NoneInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`尚未加载任何贮藏。`)
};

/**
* | output |
* | --- |
* | "No stashes loaded." |
*
* @param {Stash_NoneInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const stash_none = /** @type {((inputs?: Stash_NoneInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stash_NoneInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_stash_none(inputs)
	return en_stash_none(inputs)
});