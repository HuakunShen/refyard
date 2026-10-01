/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Conflict_Operation_MergeInputs */

const en_conflict_operation_merge = /** @type {(inputs: Conflict_Operation_MergeInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`merge`)
};

const zh_conflict_operation_merge = /** @type {(inputs: Conflict_Operation_MergeInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`合并`)
};

/**
* | output |
* | --- |
* | "merge" |
*
* @param {Conflict_Operation_MergeInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_operation_merge = /** @type {((inputs?: Conflict_Operation_MergeInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conflict_Operation_MergeInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conflict_operation_merge(inputs)
	return en_conflict_operation_merge(inputs)
});