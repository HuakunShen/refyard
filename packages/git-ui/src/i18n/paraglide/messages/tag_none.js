/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Tag_NoneInputs */

const en_tag_none = /** @type {(inputs: Tag_NoneInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No tags loaded.`)
};

const zh_tag_none = /** @type {(inputs: Tag_NoneInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`尚未加载任何标签。`)
};

/**
* | output |
* | --- |
* | "No tags loaded." |
*
* @param {Tag_NoneInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const tag_none = /** @type {((inputs?: Tag_NoneInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Tag_NoneInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_tag_none(inputs)
	return en_tag_none(inputs)
});