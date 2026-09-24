/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Working_Copy_StagedInputs */

const en_working_copy_staged = /** @type {(inputs: Working_Copy_StagedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Staged Files`)
};

const zh_working_copy_staged = /** @type {(inputs: Working_Copy_StagedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`已暂存的文件`)
};

/**
* | output |
* | --- |
* | "Staged Files" |
*
* @param {Working_Copy_StagedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_staged = /** @type {((inputs?: Working_Copy_StagedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Working_Copy_StagedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_working_copy_staged(inputs)
	return en_working_copy_staged(inputs)
});