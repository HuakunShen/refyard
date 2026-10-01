/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ stages: NonNullable<unknown> }} Conflict_StagesInputs */

const en_conflict_stages = /** @type {(inputs: Conflict_StagesInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`stages ${i?.stages}`)
};

const zh_conflict_stages = /** @type {(inputs: Conflict_StagesInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`阶段 ${i?.stages}`)
};

/**
* | output |
* | --- |
* | "stages {stages}" |
*
* @param {Conflict_StagesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_stages = /** @type {((inputs: Conflict_StagesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conflict_StagesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conflict_stages(inputs)
	return en_conflict_stages(inputs)
});