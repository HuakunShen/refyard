/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Working_Copy_ChangedInputs */

const en_working_copy_changed = /** @type {(inputs: Working_Copy_ChangedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`changed`)
};

const zh_working_copy_changed = /** @type {(inputs: Working_Copy_ChangedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`个变更`)
};

/**
* | output |
* | --- |
* | "changed" |
*
* @param {Working_Copy_ChangedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_changed = /** @type {((inputs?: Working_Copy_ChangedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Working_Copy_ChangedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_working_copy_changed(inputs)
	return en_working_copy_changed(inputs)
});