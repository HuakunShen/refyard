/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Tag_Aria_NameInputs */

const en_tag_aria_name = /** @type {(inputs: Tag_Aria_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`tag name`)
};

const zh_tag_aria_name = /** @type {(inputs: Tag_Aria_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`标签名`)
};

/**
* | output |
* | --- |
* | "tag name" |
*
* @param {Tag_Aria_NameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const tag_aria_name = /** @type {((inputs?: Tag_Aria_NameInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Tag_Aria_NameInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_tag_aria_name(inputs)
	return en_tag_aria_name(inputs)
});