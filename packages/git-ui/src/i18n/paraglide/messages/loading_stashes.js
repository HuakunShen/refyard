/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Loading_StashesInputs */

const en_loading_stashes = /** @type {(inputs: Loading_StashesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Reading stashes…`)
};

const zh_loading_stashes = /** @type {(inputs: Loading_StashesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`正在读取贮藏…`)
};

/**
* | output |
* | --- |
* | "Reading stashes…" |
*
* @param {Loading_StashesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const loading_stashes = /** @type {((inputs?: Loading_StashesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Loading_StashesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_loading_stashes(inputs)
	return en_loading_stashes(inputs)
});