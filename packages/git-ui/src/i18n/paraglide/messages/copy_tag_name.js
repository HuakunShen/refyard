/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Copy_Tag_NameInputs */

const en_copy_tag_name = /** @type {(inputs: Copy_Tag_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Copy Tag Name`)
};

const zh_copy_tag_name = /** @type {(inputs: Copy_Tag_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`复制标签名`)
};

/**
* | output |
* | --- |
* | "Copy Tag Name" |
*
* @param {Copy_Tag_NameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_tag_name = /** @type {((inputs?: Copy_Tag_NameInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Copy_Tag_NameInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_copy_tag_name(inputs)
	return en_copy_tag_name(inputs)
});