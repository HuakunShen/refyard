/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Working_Copy_Stage_AllInputs */

const en_working_copy_stage_all = /** @type {(inputs: Working_Copy_Stage_AllInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Stage all`)
};

const zh_working_copy_stage_all = /** @type {(inputs: Working_Copy_Stage_AllInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`全部暂存`)
};

/**
* | output |
* | --- |
* | "Stage all" |
*
* @param {Working_Copy_Stage_AllInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_stage_all = /** @type {((inputs?: Working_Copy_Stage_AllInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Working_Copy_Stage_AllInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_working_copy_stage_all(inputs)
	return en_working_copy_stage_all(inputs)
});