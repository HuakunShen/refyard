/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ operation: NonNullable<unknown> }} Conflict_ContinueInputs */

const en_conflict_continue = /** @type {(inputs: Conflict_ContinueInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Continue ${i?.operation}`)
};

const zh_conflict_continue = /** @type {(inputs: Conflict_ContinueInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`继续${i?.operation}`)
};

/**
* | output |
* | --- |
* | "Continue {operation}" |
*
* @param {Conflict_ContinueInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_continue = /** @type {((inputs: Conflict_ContinueInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conflict_ContinueInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conflict_continue(inputs)
	return en_conflict_continue(inputs)
});