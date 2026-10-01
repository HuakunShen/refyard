/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sub_Aria_UrlInputs */

const en_sub_aria_url = /** @type {(inputs: Sub_Aria_UrlInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`submodule url`)
};

const zh_sub_aria_url = /** @type {(inputs: Sub_Aria_UrlInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`子模块地址`)
};

/**
* | output |
* | --- |
* | "submodule url" |
*
* @param {Sub_Aria_UrlInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sub_aria_url = /** @type {((inputs?: Sub_Aria_UrlInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sub_Aria_UrlInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_sub_aria_url(inputs)
	return en_sub_aria_url(inputs)
});