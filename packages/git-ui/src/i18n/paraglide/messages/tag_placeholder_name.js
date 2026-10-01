/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Tag_Placeholder_NameInputs */

const en_tag_placeholder_name = /** @type {(inputs: Tag_Placeholder_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`v1.0.0`)
};

const zh_tag_placeholder_name = /** @type {(inputs: Tag_Placeholder_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`v1.0.0`)
};

/**
* | output |
* | --- |
* | "v1.0.0" |
*
* @param {Tag_Placeholder_NameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const tag_placeholder_name = /** @type {((inputs?: Tag_Placeholder_NameInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Tag_Placeholder_NameInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_tag_placeholder_name(inputs)
	return en_tag_placeholder_name(inputs)
});