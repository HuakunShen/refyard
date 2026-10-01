/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ subject: NonNullable<unknown> }} Dialog_Drop_ConfirmInputs */

const en_dialog_drop_confirm = /** @type {(inputs: Dialog_Drop_ConfirmInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Drop "${i?.subject}"`)
};

const zh_dialog_drop_confirm = /** @type {(inputs: Dialog_Drop_ConfirmInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`丢弃「${i?.subject}」`)
};

/**
* | output |
* | --- |
* | "Drop \"{subject}\"" |
*
* @param {Dialog_Drop_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_drop_confirm = /** @type {((inputs: Dialog_Drop_ConfirmInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Drop_ConfirmInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_drop_confirm(inputs)
	return en_dialog_drop_confirm(inputs)
});