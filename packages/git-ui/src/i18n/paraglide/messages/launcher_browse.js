/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launcher_BrowseInputs */

const en_launcher_browse = /** @type {(inputs: Launcher_BrowseInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Browse`)
};

const zh_launcher_browse = /** @type {(inputs: Launcher_BrowseInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`浏览`)
};

/**
* | output |
* | --- |
* | "Browse" |
*
* @param {Launcher_BrowseInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_browse = /** @type {((inputs?: Launcher_BrowseInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launcher_BrowseInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launcher_browse(inputs)
	return en_launcher_browse(inputs)
});