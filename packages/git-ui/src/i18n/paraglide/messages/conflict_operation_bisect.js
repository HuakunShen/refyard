/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Conflict_Operation_BisectInputs */

const en_conflict_operation_bisect = /** @type {(inputs: Conflict_Operation_BisectInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`bisect`)
};

const zh_conflict_operation_bisect = /** @type {(inputs: Conflict_Operation_BisectInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`二分查找`)
};

/**
* | output |
* | --- |
* | "bisect" |
*
* @param {Conflict_Operation_BisectInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_operation_bisect = /** @type {((inputs?: Conflict_Operation_BisectInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conflict_Operation_BisectInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conflict_operation_bisect(inputs)
	return en_conflict_operation_bisect(inputs)
});