/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Remote_Fetch_UrlInputs */

const en_remote_fetch_url = /** @type {(inputs: Remote_Fetch_UrlInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Fetch URL`)
};

const zh_remote_fetch_url = /** @type {(inputs: Remote_Fetch_UrlInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`抓取地址`)
};

/**
* | output |
* | --- |
* | "Fetch URL" |
*
* @param {Remote_Fetch_UrlInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_fetch_url = /** @type {((inputs?: Remote_Fetch_UrlInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Remote_Fetch_UrlInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_remote_fetch_url(inputs)
	return en_remote_fetch_url(inputs)
});