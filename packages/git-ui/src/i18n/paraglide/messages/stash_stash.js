/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Stash_StashInputs */

const en_stash_stash = /** @type {(inputs: Stash_StashInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Stash`)
};

const zh_stash_stash = /** @type {(inputs: Stash_StashInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`贮藏`)
};

/**
* | output |
* | --- |
* | "Stash" |
*
* @param {Stash_StashInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const stash_stash = /** @type {((inputs?: Stash_StashInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stash_StashInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_stash_stash(inputs)
	return en_stash_stash(inputs)
});