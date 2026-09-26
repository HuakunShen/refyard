/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Working_Copy_AmendInputs */

const en_working_copy_amend = /** @type {(inputs: Working_Copy_AmendInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Amend…`)
};

const zh_working_copy_amend = /** @type {(inputs: Working_Copy_AmendInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`修补提交…`)
};

/**
* | output |
* | --- |
* | "Amend…" |
*
* @param {Working_Copy_AmendInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_amend = /** @type {((inputs?: Working_Copy_AmendInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Working_Copy_AmendInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_working_copy_amend(inputs)
	return en_working_copy_amend(inputs)
});