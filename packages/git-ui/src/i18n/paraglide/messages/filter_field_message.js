/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Filter_Field_MessageInputs */

const en_filter_field_message = /** @type {(inputs: Filter_Field_MessageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Message`)
};

const zh_filter_field_message = /** @type {(inputs: Filter_Field_MessageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`提交信息`)
};

/**
* | output |
* | --- |
* | "Message" |
*
* @param {Filter_Field_MessageInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filter_field_message = /** @type {((inputs?: Filter_Field_MessageInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filter_Field_MessageInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filter_field_message(inputs)
	return en_filter_field_message(inputs)
});