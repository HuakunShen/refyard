/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ subject: NonNullable<unknown> }} Dialog_Revert_ConfirmInputs */

const en_dialog_revert_confirm = /** @type {(inputs: Dialog_Revert_ConfirmInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Revert "${i?.subject}"`)
};

const zh_dialog_revert_confirm = /** @type {(inputs: Dialog_Revert_ConfirmInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`还原「${i?.subject}」`)
};

/**
* | output |
* | --- |
* | "Revert \"{subject}\"" |
*
* @param {Dialog_Revert_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_revert_confirm = /** @type {((inputs: Dialog_Revert_ConfirmInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Revert_ConfirmInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_revert_confirm(inputs)
	return en_dialog_revert_confirm(inputs)
});