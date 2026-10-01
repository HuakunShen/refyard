/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Conflict_Operation_RebaseInputs */

const en_conflict_operation_rebase = /** @type {(inputs: Conflict_Operation_RebaseInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`rebase`)
};

const zh_conflict_operation_rebase = /** @type {(inputs: Conflict_Operation_RebaseInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`变基`)
};

/**
* | output |
* | --- |
* | "rebase" |
*
* @param {Conflict_Operation_RebaseInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_operation_rebase = /** @type {((inputs?: Conflict_Operation_RebaseInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conflict_Operation_RebaseInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conflict_operation_rebase(inputs)
	return en_conflict_operation_rebase(inputs)
});