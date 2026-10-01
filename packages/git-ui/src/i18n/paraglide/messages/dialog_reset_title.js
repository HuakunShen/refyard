/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ branch: NonNullable<unknown>, subject: NonNullable<unknown> }} Dialog_Reset_TitleInputs */

const en_dialog_reset_title = /** @type {(inputs: Dialog_Reset_TitleInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Reset ${i?.branch} to "${i?.subject}"?`)
};

const zh_dialog_reset_title = /** @type {(inputs: Dialog_Reset_TitleInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`将 ${i?.branch} 重置到「${i?.subject}」？`)
};

/**
* | output |
* | --- |
* | "Reset {branch} to \"{subject}\"?" |
*
* @param {Dialog_Reset_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_reset_title = /** @type {((inputs: Dialog_Reset_TitleInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Reset_TitleInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_reset_title(inputs)
	return en_dialog_reset_title(inputs)
});