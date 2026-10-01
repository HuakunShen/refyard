/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Tag_NameInputs */

const en_dialog_tag_name = /** @type {(inputs: Dialog_Tag_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Tag name`)
};

const zh_dialog_tag_name = /** @type {(inputs: Dialog_Tag_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`标签名`)
};

/**
* | output |
* | --- |
* | "Tag name" |
*
* @param {Dialog_Tag_NameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_tag_name = /** @type {((inputs?: Dialog_Tag_NameInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Tag_NameInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_tag_name(inputs)
	return en_dialog_tag_name(inputs)
});