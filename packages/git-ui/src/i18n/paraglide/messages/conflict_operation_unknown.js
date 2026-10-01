/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Conflict_Operation_UnknownInputs */

const en_conflict_operation_unknown = /** @type {(inputs: Conflict_Operation_UnknownInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`unknown operation`)
};

const zh_conflict_operation_unknown = /** @type {(inputs: Conflict_Operation_UnknownInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`未知操作`)
};

/**
* | output |
* | --- |
* | "unknown operation" |
*
* @param {Conflict_Operation_UnknownInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_operation_unknown = /** @type {((inputs?: Conflict_Operation_UnknownInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conflict_Operation_UnknownInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conflict_operation_unknown(inputs)
	return en_conflict_operation_unknown(inputs)
});