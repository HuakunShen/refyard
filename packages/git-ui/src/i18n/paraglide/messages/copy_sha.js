/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Copy_ShaInputs */

const en_copy_sha = /** @type {(inputs: Copy_ShaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Copy SHA`)
};

const zh_copy_sha = /** @type {(inputs: Copy_ShaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`复制 SHA`)
};

/**
* | output |
* | --- |
* | "Copy SHA" |
*
* @param {Copy_ShaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_sha = /** @type {((inputs?: Copy_ShaInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Copy_ShaInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_copy_sha(inputs)
	return en_copy_sha(inputs)
});