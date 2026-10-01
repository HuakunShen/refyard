/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Stash_None_ShortInputs */

const en_stash_none_short = /** @type {(inputs: Stash_None_ShortInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No stashes.`)
};

const zh_stash_none_short = /** @type {(inputs: Stash_None_ShortInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`没有贮藏。`)
};

/**
* | output |
* | --- |
* | "No stashes." |
*
* @param {Stash_None_ShortInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const stash_none_short = /** @type {((inputs?: Stash_None_ShortInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stash_None_ShortInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_stash_none_short(inputs)
	return en_stash_none_short(inputs)
});