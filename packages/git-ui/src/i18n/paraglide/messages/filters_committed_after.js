/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Filters_Committed_AfterInputs */

const en_filters_committed_after = /** @type {(inputs: Filters_Committed_AfterInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Committed after (UTC)`)
};

const zh_filters_committed_after = /** @type {(inputs: Filters_Committed_AfterInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`提交时间晚于(UTC)`)
};

/**
* | output |
* | --- |
* | "Committed after (UTC)" |
*
* @param {Filters_Committed_AfterInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_committed_after = /** @type {((inputs?: Filters_Committed_AfterInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filters_Committed_AfterInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filters_committed_after(inputs)
	return en_filters_committed_after(inputs)
});