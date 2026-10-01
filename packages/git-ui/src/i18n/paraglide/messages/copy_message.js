/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Copy_MessageInputs */

const en_copy_message = /** @type {(inputs: Copy_MessageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Copy Message`)
};

const zh_copy_message = /** @type {(inputs: Copy_MessageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`复制提交信息`)
};

/**
* | output |
* | --- |
* | "Copy Message" |
*
* @param {Copy_MessageInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_message = /** @type {((inputs?: Copy_MessageInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Copy_MessageInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_copy_message(inputs)
	return en_copy_message(inputs)
});