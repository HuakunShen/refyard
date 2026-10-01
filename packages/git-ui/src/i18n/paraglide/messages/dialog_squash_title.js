/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ subject: NonNullable<unknown> }} Dialog_Squash_TitleInputs */

const en_dialog_squash_title = /** @type {(inputs: Dialog_Squash_TitleInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Squash "${i?.subject}" into the commit below?`)
};

const zh_dialog_squash_title = /** @type {(inputs: Dialog_Squash_TitleInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`将「${i?.subject}」并入下方提交？`)
};

/**
* | output |
* | --- |
* | "Squash \"{subject}\" into the commit below?" |
*
* @param {Dialog_Squash_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_squash_title = /** @type {((inputs: Dialog_Squash_TitleInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Squash_TitleInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_squash_title(inputs)
	return en_dialog_squash_title(inputs)
});