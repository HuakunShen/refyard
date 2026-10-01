/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ parent: NonNullable<unknown> }} Dialog_Squash_MessageInputs */

const en_dialog_squash_message = /** @type {(inputs: Dialog_Squash_MessageInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Commit message — leave empty to keep "${i?.parent}"`)
};

const zh_dialog_squash_message = /** @type {(inputs: Dialog_Squash_MessageInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`提交说明 — 留空以保留「${i?.parent}」`)
};

/**
* | output |
* | --- |
* | "Commit message — leave empty to keep \"{parent}\"" |
*
* @param {Dialog_Squash_MessageInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_squash_message = /** @type {((inputs: Dialog_Squash_MessageInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Squash_MessageInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_squash_message(inputs)
	return en_dialog_squash_message(inputs)
});