/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Loading_RemotesInputs */

const en_loading_remotes = /** @type {(inputs: Loading_RemotesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Reading remotes…`)
};

const zh_loading_remotes = /** @type {(inputs: Loading_RemotesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`正在读取远程…`)
};

/**
* | output |
* | --- |
* | "Reading remotes…" |
*
* @param {Loading_RemotesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const loading_remotes = /** @type {((inputs?: Loading_RemotesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Loading_RemotesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_loading_remotes(inputs)
	return en_loading_remotes(inputs)
});