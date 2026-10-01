/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Loading_RefsInputs */

const en_loading_refs = /** @type {(inputs: Loading_RefsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Reading refs…`)
};

const zh_loading_refs = /** @type {(inputs: Loading_RefsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`正在读取引用…`)
};

/**
* | output |
* | --- |
* | "Reading refs…" |
*
* @param {Loading_RefsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const loading_refs = /** @type {((inputs?: Loading_RefsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Loading_RefsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_loading_refs(inputs)
	return en_loading_refs(inputs)
});