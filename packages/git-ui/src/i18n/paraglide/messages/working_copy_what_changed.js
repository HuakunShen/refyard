/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Working_Copy_What_ChangedInputs */

const en_working_copy_what_changed = /** @type {(inputs: Working_Copy_What_ChangedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`What changed, and why`)
};

const zh_working_copy_what_changed = /** @type {(inputs: Working_Copy_What_ChangedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`改了什么,为什么改`)
};

/**
* | output |
* | --- |
* | "What changed, and why" |
*
* @param {Working_Copy_What_ChangedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_what_changed = /** @type {((inputs?: Working_Copy_What_ChangedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Working_Copy_What_ChangedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_working_copy_what_changed(inputs)
	return en_working_copy_what_changed(inputs)
});