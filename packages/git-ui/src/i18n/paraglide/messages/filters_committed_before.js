/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Filters_Committed_BeforeInputs */

const en_filters_committed_before = /** @type {(inputs: Filters_Committed_BeforeInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Committed before (UTC)`)
};

const zh_filters_committed_before = /** @type {(inputs: Filters_Committed_BeforeInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`提交时间早于(UTC)`)
};

/**
* | output |
* | --- |
* | "Committed before (UTC)" |
*
* @param {Filters_Committed_BeforeInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_committed_before = /** @type {((inputs?: Filters_Committed_BeforeInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filters_Committed_BeforeInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filters_committed_before(inputs)
	return en_filters_committed_before(inputs)
});