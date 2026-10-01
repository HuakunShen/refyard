/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ commit: NonNullable<unknown> }} Dialog_Create_Tag_TitleInputs */

const en_dialog_create_tag_title = /** @type {(inputs: Dialog_Create_Tag_TitleInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Create tag at ${i?.commit}`)
};

const zh_dialog_create_tag_title = /** @type {(inputs: Dialog_Create_Tag_TitleInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`在 ${i?.commit} 创建标签`)
};

/**
* | output |
* | --- |
* | "Create tag at {commit}" |
*
* @param {Dialog_Create_Tag_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_create_tag_title = /** @type {((inputs: Dialog_Create_Tag_TitleInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Create_Tag_TitleInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_create_tag_title(inputs)
	return en_dialog_create_tag_title(inputs)
});