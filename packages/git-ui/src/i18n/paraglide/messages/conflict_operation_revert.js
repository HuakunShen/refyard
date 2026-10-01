/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Conflict_Operation_RevertInputs */

const en_conflict_operation_revert = /** @type {(inputs: Conflict_Operation_RevertInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`revert`)
};

const zh_conflict_operation_revert = /** @type {(inputs: Conflict_Operation_RevertInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`还原提交`)
};

/**
* | output |
* | --- |
* | "revert" |
*
* @param {Conflict_Operation_RevertInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_operation_revert = /** @type {((inputs?: Conflict_Operation_RevertInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conflict_Operation_RevertInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conflict_operation_revert(inputs)
	return en_conflict_operation_revert(inputs)
});