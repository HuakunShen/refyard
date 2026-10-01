/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Stash_PopInputs */

const en_stash_pop = /** @type {(inputs: Stash_PopInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Pop and drop the entry`)
};

const zh_stash_pop = /** @type {(inputs: Stash_PopInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`弹出并删除该贮藏`)
};

/**
* | output |
* | --- |
* | "Pop and drop the entry" |
*
* @param {Stash_PopInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const stash_pop = /** @type {((inputs?: Stash_PopInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stash_PopInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_stash_pop(inputs)
	return en_stash_pop(inputs)
});