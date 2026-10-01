/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ commit: NonNullable<unknown> }} Dialog_Create_Branch_TitleInputs */

const en_dialog_create_branch_title = /** @type {(inputs: Dialog_Create_Branch_TitleInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Create branch at ${i?.commit}`)
};

const zh_dialog_create_branch_title = /** @type {(inputs: Dialog_Create_Branch_TitleInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`在 ${i?.commit} 创建分支`)
};

/**
* | output |
* | --- |
* | "Create branch at {commit}" |
*
* @param {Dialog_Create_Branch_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_create_branch_title = /** @type {((inputs: Dialog_Create_Branch_TitleInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Create_Branch_TitleInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_create_branch_title(inputs)
	return en_dialog_create_branch_title(inputs)
});