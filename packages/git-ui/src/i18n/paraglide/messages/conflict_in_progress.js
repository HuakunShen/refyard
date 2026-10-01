/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ operation: NonNullable<unknown> }} Conflict_In_ProgressInputs */

const en_conflict_in_progress = /** @type {(inputs: Conflict_In_ProgressInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`${i?.operation} in progress`)
};

const zh_conflict_in_progress = /** @type {(inputs: Conflict_In_ProgressInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`${i?.operation}进行中`)
};

/**
* | output |
* | --- |
* | "{operation} in progress" |
*
* @param {Conflict_In_ProgressInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_in_progress = /** @type {((inputs: Conflict_In_ProgressInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conflict_In_ProgressInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conflict_in_progress(inputs)
	return en_conflict_in_progress(inputs)
});