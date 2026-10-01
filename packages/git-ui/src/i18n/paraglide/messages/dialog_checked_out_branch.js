/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Checked_Out_BranchInputs */

const en_dialog_checked_out_branch = /** @type {(inputs: Dialog_Checked_Out_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`the checked-out branch`)
};

const zh_dialog_checked_out_branch = /** @type {(inputs: Dialog_Checked_Out_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`当前检出的分支`)
};

/**
* | output |
* | --- |
* | "the checked-out branch" |
*
* @param {Dialog_Checked_Out_BranchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_checked_out_branch = /** @type {((inputs?: Dialog_Checked_Out_BranchInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Checked_Out_BranchInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_checked_out_branch(inputs)
	return en_dialog_checked_out_branch(inputs)
});