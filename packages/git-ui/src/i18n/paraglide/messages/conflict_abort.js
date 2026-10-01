/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ operation: NonNullable<unknown> }} Conflict_AbortInputs */

const en_conflict_abort = /** @type {(inputs: Conflict_AbortInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Abort ${i?.operation}`)
};

const zh_conflict_abort = /** @type {(inputs: Conflict_AbortInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`中止${i?.operation}`)
};

/**
* | output |
* | --- |
* | "Abort {operation}" |
*
* @param {Conflict_AbortInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_abort = /** @type {((inputs: Conflict_AbortInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conflict_AbortInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conflict_abort(inputs)
	return en_conflict_abort(inputs)
});