/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Remote_Push_UrlInputs */

const en_remote_push_url = /** @type {(inputs: Remote_Push_UrlInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Push URL`)
};

const zh_remote_push_url = /** @type {(inputs: Remote_Push_UrlInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`推送地址`)
};

/**
* | output |
* | --- |
* | "Push URL" |
*
* @param {Remote_Push_UrlInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_push_url = /** @type {((inputs?: Remote_Push_UrlInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Remote_Push_UrlInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_remote_push_url(inputs)
	return en_remote_push_url(inputs)
});