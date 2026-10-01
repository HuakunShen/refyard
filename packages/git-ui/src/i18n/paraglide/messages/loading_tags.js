/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Loading_TagsInputs */

const en_loading_tags = /** @type {(inputs: Loading_TagsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Reading tags…`)
};

const zh_loading_tags = /** @type {(inputs: Loading_TagsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`正在读取标签…`)
};

/**
* | output |
* | --- |
* | "Reading tags…" |
*
* @param {Loading_TagsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const loading_tags = /** @type {((inputs?: Loading_TagsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Loading_TagsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_loading_tags(inputs)
	return en_loading_tags(inputs)
});