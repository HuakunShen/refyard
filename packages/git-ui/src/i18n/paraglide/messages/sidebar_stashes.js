/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sidebar_StashesInputs */

const en_sidebar_stashes = /** @type {(inputs: Sidebar_StashesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Stashes`)
};

const zh_sidebar_stashes = /** @type {(inputs: Sidebar_StashesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`贮藏`)
};

/**
* | output |
* | --- |
* | "Stashes" |
*
* @param {Sidebar_StashesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sidebar_stashes = /** @type {((inputs?: Sidebar_StashesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sidebar_StashesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_sidebar_stashes(inputs)
	return en_sidebar_stashes(inputs)
});