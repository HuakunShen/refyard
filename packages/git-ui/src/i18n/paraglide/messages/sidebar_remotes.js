/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sidebar_RemotesInputs */

const en_sidebar_remotes = /** @type {(inputs: Sidebar_RemotesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Remotes`)
};

const zh_sidebar_remotes = /** @type {(inputs: Sidebar_RemotesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`远程`)
};

/**
* | output |
* | --- |
* | "Remotes" |
*
* @param {Sidebar_RemotesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sidebar_remotes = /** @type {((inputs?: Sidebar_RemotesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sidebar_RemotesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_sidebar_remotes(inputs)
	return en_sidebar_remotes(inputs)
});