/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Copy_StageInputs */

const en_copy_stage = /** @type {(inputs: Copy_StageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Stage`)
};

const zh_copy_stage = /** @type {(inputs: Copy_StageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`暂存`)
};

/**
* | output |
* | --- |
* | "Stage" |
*
* @param {Copy_StageInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_stage = /** @type {((inputs?: Copy_StageInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Copy_StageInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_copy_stage(inputs)
	return en_copy_stage(inputs)
});