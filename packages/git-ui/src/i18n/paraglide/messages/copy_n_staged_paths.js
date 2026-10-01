/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ n: NonNullable<unknown>, s: NonNullable<unknown> }} Copy_N_Staged_PathsInputs */

const en_copy_n_staged_paths = /** @type {(inputs: Copy_N_Staged_PathsInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`${i?.n} staged path${i?.s}`)
};

const zh_copy_n_staged_paths = /** @type {(inputs: Copy_N_Staged_PathsInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`${i?.n} 个暂存路径`)
};

/**
* | output |
* | --- |
* | "{n} staged path{s}" |
*
* @param {Copy_N_Staged_PathsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_n_staged_paths = /** @type {((inputs: Copy_N_Staged_PathsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Copy_N_Staged_PathsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_copy_n_staged_paths(inputs)
	return en_copy_n_staged_paths(inputs)
});