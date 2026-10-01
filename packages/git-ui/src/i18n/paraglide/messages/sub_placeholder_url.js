/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sub_Placeholder_UrlInputs */

const en_sub_placeholder_url = /** @type {(inputs: Sub_Placeholder_UrlInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`remote URL (cloned when added)`)
};

const zh_sub_placeholder_url = /** @type {(inputs: Sub_Placeholder_UrlInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`远程地址(添加时克隆)`)
};

/**
* | output |
* | --- |
* | "remote URL (cloned when added)" |
*
* @param {Sub_Placeholder_UrlInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sub_placeholder_url = /** @type {((inputs?: Sub_Placeholder_UrlInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sub_Placeholder_UrlInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_sub_placeholder_url(inputs)
	return en_sub_placeholder_url(inputs)
});