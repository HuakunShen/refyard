/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Loading_DiffInputs */

const en_loading_diff = /** @type {(inputs: Loading_DiffInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Reading diff…`)
};

const zh_loading_diff = /** @type {(inputs: Loading_DiffInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`正在读取差异…`)
};

/**
* | output |
* | --- |
* | "Reading diff…" |
*
* @param {Loading_DiffInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const loading_diff = /** @type {((inputs?: Loading_DiffInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Loading_DiffInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_loading_diff(inputs)
	return en_loading_diff(inputs)
});