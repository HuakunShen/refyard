/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Toolbar_FetchInputs */

const en_toolbar_fetch = /** @type {(inputs: Toolbar_FetchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Fetch`)
};

const zh_toolbar_fetch = /** @type {(inputs: Toolbar_FetchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`拉取`)
};

/**
* | output |
* | --- |
* | "Fetch" |
*
* @param {Toolbar_FetchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_fetch = /** @type {((inputs?: Toolbar_FetchInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Toolbar_FetchInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_toolbar_fetch(inputs)
	return en_toolbar_fetch(inputs)
});