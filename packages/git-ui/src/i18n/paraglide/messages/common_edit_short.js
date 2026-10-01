/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Common_Edit_ShortInputs */

const en_common_edit_short = /** @type {(inputs: Common_Edit_ShortInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Edit`)
};

const zh_common_edit_short = /** @type {(inputs: Common_Edit_ShortInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`编辑`)
};

/**
* | output |
* | --- |
* | "Edit" |
*
* @param {Common_Edit_ShortInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_edit_short = /** @type {((inputs?: Common_Edit_ShortInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Common_Edit_ShortInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_common_edit_short(inputs)
	return en_common_edit_short(inputs)
});