/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ subject: NonNullable<unknown>, branch: NonNullable<unknown> }} Dialog_Cherry_Pick_TitleInputs */

const en_dialog_cherry_pick_title = /** @type {(inputs: Dialog_Cherry_Pick_TitleInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Cherry-pick "${i?.subject}" onto ${i?.branch}?`)
};

const zh_dialog_cherry_pick_title = /** @type {(inputs: Dialog_Cherry_Pick_TitleInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`将「${i?.subject}」摘取到 ${i?.branch}？`)
};

/**
* | output |
* | --- |
* | "Cherry-pick \"{subject}\" onto {branch}?" |
*
* @param {Dialog_Cherry_Pick_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_cherry_pick_title = /** @type {((inputs: Dialog_Cherry_Pick_TitleInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Cherry_Pick_TitleInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_cherry_pick_title(inputs)
	return en_dialog_cherry_pick_title(inputs)
});