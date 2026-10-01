/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Remote_Aria_UrlInputs */

const en_remote_aria_url = /** @type {(inputs: Remote_Aria_UrlInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`remote url`)
};

const zh_remote_aria_url = /** @type {(inputs: Remote_Aria_UrlInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`远程地址`)
};

/**
* | output |
* | --- |
* | "remote url" |
*
* @param {Remote_Aria_UrlInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_aria_url = /** @type {((inputs?: Remote_Aria_UrlInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Remote_Aria_UrlInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_remote_aria_url(inputs)
	return en_remote_aria_url(inputs)
});