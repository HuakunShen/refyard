/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Tag_None_ShortInputs */

const en_tag_none_short = /** @type {(inputs: Tag_None_ShortInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No tags.`)
};

const zh_tag_none_short = /** @type {(inputs: Tag_None_ShortInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`没有标签。`)
};

/**
* | output |
* | --- |
* | "No tags." |
*
* @param {Tag_None_ShortInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const tag_none_short = /** @type {((inputs?: Tag_None_ShortInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Tag_None_ShortInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_tag_none_short(inputs)
	return en_tag_none_short(inputs)
});