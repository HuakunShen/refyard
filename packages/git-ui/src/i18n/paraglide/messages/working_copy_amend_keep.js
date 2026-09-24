/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Working_Copy_Amend_KeepInputs */

const en_working_copy_amend_keep = /** @type {(inputs: Working_Copy_Amend_KeepInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Amend, keep message`)
};

const zh_working_copy_amend_keep = /** @type {(inputs: Working_Copy_Amend_KeepInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`修补提交,保留信息`)
};

/**
* | output |
* | --- |
* | "Amend, keep message" |
*
* @param {Working_Copy_Amend_KeepInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_amend_keep = /** @type {((inputs?: Working_Copy_Amend_KeepInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Working_Copy_Amend_KeepInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_working_copy_amend_keep(inputs)
	return en_working_copy_amend_keep(inputs)
});