/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Toolbar_Pop_StashInputs */

const en_toolbar_pop_stash = /** @type {(inputs: Toolbar_Pop_StashInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Pop stash`)
};

const zh_toolbar_pop_stash = /** @type {(inputs: Toolbar_Pop_StashInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`弹出贮藏`)
};

/**
* | output |
* | --- |
* | "Pop stash" |
*
* @param {Toolbar_Pop_StashInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_pop_stash = /** @type {((inputs?: Toolbar_Pop_StashInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Toolbar_Pop_StashInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_toolbar_pop_stash(inputs)
	return en_toolbar_pop_stash(inputs)
});