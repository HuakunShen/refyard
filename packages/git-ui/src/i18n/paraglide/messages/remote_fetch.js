/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Remote_FetchInputs */

const en_remote_fetch = /** @type {(inputs: Remote_FetchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Fetch`)
};

const zh_remote_fetch = /** @type {(inputs: Remote_FetchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`抓取`)
};

/**
* | output |
* | --- |
* | "Fetch" |
*
* @param {Remote_FetchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_fetch = /** @type {((inputs?: Remote_FetchInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Remote_FetchInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_remote_fetch(inputs)
	return en_remote_fetch(inputs)
});