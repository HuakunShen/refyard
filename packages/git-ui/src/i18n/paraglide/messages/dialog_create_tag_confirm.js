/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Create_Tag_ConfirmInputs */

const en_dialog_create_tag_confirm = /** @type {(inputs: Dialog_Create_Tag_ConfirmInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Create tag`)
};

const zh_dialog_create_tag_confirm = /** @type {(inputs: Dialog_Create_Tag_ConfirmInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`创建标签`)
};

/**
* | output |
* | --- |
* | "Create tag" |
*
* @param {Dialog_Create_Tag_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_create_tag_confirm = /** @type {((inputs?: Dialog_Create_Tag_ConfirmInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Create_Tag_ConfirmInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_create_tag_confirm(inputs)
	return en_dialog_create_tag_confirm(inputs)
});