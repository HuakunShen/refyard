/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Conflict_No_StagesInputs */

const en_conflict_no_stages = /** @type {(inputs: Conflict_No_StagesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`no stages read`)
};

const zh_conflict_no_stages = /** @type {(inputs: Conflict_No_StagesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`未读取冲突阶段`)
};

/**
* | output |
* | --- |
* | "no stages read" |
*
* @param {Conflict_No_StagesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_no_stages = /** @type {((inputs?: Conflict_No_StagesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conflict_No_StagesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conflict_no_stages(inputs)
	return en_conflict_no_stages(inputs)
});