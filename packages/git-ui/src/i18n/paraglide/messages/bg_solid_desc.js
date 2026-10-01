/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Bg_Solid_DescInputs */

const en_bg_solid_desc = /** @type {(inputs: Bg_Solid_DescInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Clean minimal workbench`)
};

const zh_bg_solid_desc = /** @type {(inputs: Bg_Solid_DescInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`干净极简的工作台`)
};

/**
* | output |
* | --- |
* | "Clean minimal workbench" |
*
* @param {Bg_Solid_DescInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const bg_solid_desc = /** @type {((inputs?: Bg_Solid_DescInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Bg_Solid_DescInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_bg_solid_desc(inputs)
	return en_bg_solid_desc(inputs)
});