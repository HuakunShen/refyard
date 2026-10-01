/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Copy_NameInputs */

const en_copy_name = /** @type {(inputs: Copy_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Copy Name`)
};

const zh_copy_name = /** @type {(inputs: Copy_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`复制名称`)
};

/**
* | output |
* | --- |
* | "Copy Name" |
*
* @param {Copy_NameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_name = /** @type {((inputs?: Copy_NameInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Copy_NameInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_copy_name(inputs)
	return en_copy_name(inputs)
});