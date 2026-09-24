/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Working_Copy_Nothing_StagedInputs */

const en_working_copy_nothing_staged = /** @type {(inputs: Working_Copy_Nothing_StagedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Nothing staged.`)
};

const zh_working_copy_nothing_staged = /** @type {(inputs: Working_Copy_Nothing_StagedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`没有已暂存的内容。`)
};

/**
* | output |
* | --- |
* | "Nothing staged." |
*
* @param {Working_Copy_Nothing_StagedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_nothing_staged = /** @type {((inputs?: Working_Copy_Nothing_StagedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Working_Copy_Nothing_StagedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_working_copy_nothing_staged(inputs)
	return en_working_copy_nothing_staged(inputs)
});