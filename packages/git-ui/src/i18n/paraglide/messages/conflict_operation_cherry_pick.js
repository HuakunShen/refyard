/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Conflict_Operation_Cherry_PickInputs */

const en_conflict_operation_cherry_pick = /** @type {(inputs: Conflict_Operation_Cherry_PickInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`cherry-pick`)
};

const zh_conflict_operation_cherry_pick = /** @type {(inputs: Conflict_Operation_Cherry_PickInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`摘取`)
};

/**
* | output |
* | --- |
* | "cherry-pick" |
*
* @param {Conflict_Operation_Cherry_PickInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_operation_cherry_pick = /** @type {((inputs?: Conflict_Operation_Cherry_PickInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conflict_Operation_Cherry_PickInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conflict_operation_cherry_pick(inputs)
	return en_conflict_operation_cherry_pick(inputs)
});