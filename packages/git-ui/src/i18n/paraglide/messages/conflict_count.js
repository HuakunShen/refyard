/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ n: NonNullable<unknown> }} Conflict_CountInputs */

const en_conflict_count = /** @type {(inputs: Conflict_CountInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`${i?.n} conflicted path(s)`)
};

const zh_conflict_count = /** @type {(inputs: Conflict_CountInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`${i?.n} 个冲突文件`)
};

/**
* | output |
* | --- |
* | "{n} conflicted path(s)" |
*
* @param {Conflict_CountInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_count = /** @type {((inputs: Conflict_CountInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conflict_CountInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conflict_count(inputs)
	return en_conflict_count(inputs)
});