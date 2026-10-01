/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Diff_Patches_One_PathInputs */

const en_diff_patches_one_path = /** @type {(inputs: Diff_Patches_One_PathInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Patches are read one path at a time`)
};

const zh_diff_patches_one_path = /** @type {(inputs: Diff_Patches_One_PathInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`补丁按路径逐个读取`)
};

/**
* | output |
* | --- |
* | "Patches are read one path at a time" |
*
* @param {Diff_Patches_One_PathInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const diff_patches_one_path = /** @type {((inputs?: Diff_Patches_One_PathInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Diff_Patches_One_PathInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_diff_patches_one_path(inputs)
	return en_diff_patches_one_path(inputs)
});