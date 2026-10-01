/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ subject: NonNullable<unknown> }} Dialog_Cherry_Pick_ConfirmInputs */

const en_dialog_cherry_pick_confirm = /** @type {(inputs: Dialog_Cherry_Pick_ConfirmInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Cherry-pick "${i?.subject}"`)
};

const zh_dialog_cherry_pick_confirm = /** @type {(inputs: Dialog_Cherry_Pick_ConfirmInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`摘取「${i?.subject}」`)
};

/**
* | output |
* | --- |
* | "Cherry-pick \"{subject}\"" |
*
* @param {Dialog_Cherry_Pick_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_cherry_pick_confirm = /** @type {((inputs: Dialog_Cherry_Pick_ConfirmInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Cherry_Pick_ConfirmInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_cherry_pick_confirm(inputs)
	return en_dialog_cherry_pick_confirm(inputs)
});