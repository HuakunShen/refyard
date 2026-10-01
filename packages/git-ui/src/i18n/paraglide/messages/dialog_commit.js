/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_CommitInputs */

const en_dialog_commit = /** @type {(inputs: Dialog_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`commit`)
};

const zh_dialog_commit = /** @type {(inputs: Dialog_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`提交`)
};

/**
* | output |
* | --- |
* | "commit" |
*
* @param {Dialog_CommitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_commit = /** @type {((inputs?: Dialog_CommitInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_CommitInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_commit(inputs)
	return en_dialog_commit(inputs)
});