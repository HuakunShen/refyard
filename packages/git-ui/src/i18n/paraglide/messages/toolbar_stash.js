/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Toolbar_StashInputs */

const en_toolbar_stash = /** @type {(inputs: Toolbar_StashInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Stash`)
};

const zh_toolbar_stash = /** @type {(inputs: Toolbar_StashInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`贮藏`)
};

/**
* | output |
* | --- |
* | "Stash" |
*
* @param {Toolbar_StashInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_stash = /** @type {((inputs?: Toolbar_StashInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Toolbar_StashInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_toolbar_stash(inputs)
	return en_toolbar_stash(inputs)
});