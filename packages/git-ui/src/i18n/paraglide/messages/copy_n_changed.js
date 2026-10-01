/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ n: NonNullable<unknown> }} Copy_N_ChangedInputs */

const en_copy_n_changed = /** @type {(inputs: Copy_N_ChangedInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`${i?.n} changed`)
};

const zh_copy_n_changed = /** @type {(inputs: Copy_N_ChangedInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`${i?.n} 个变更`)
};

/**
* | output |
* | --- |
* | "{n} changed" |
*
* @param {Copy_N_ChangedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_n_changed = /** @type {((inputs: Copy_N_ChangedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Copy_N_ChangedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_copy_n_changed(inputs)
	return en_copy_n_changed(inputs)
});