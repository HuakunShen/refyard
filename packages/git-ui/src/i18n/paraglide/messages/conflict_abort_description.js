/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Conflict_Abort_DescriptionInputs */

const en_conflict_abort_description = /** @type {(inputs: Conflict_Abort_DescriptionInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Restores the commit and index the operation started from.`)
};

const zh_conflict_abort_description = /** @type {(inputs: Conflict_Abort_DescriptionInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`恢复操作开始时的提交和暂存区。`)
};

/**
* | output |
* | --- |
* | "Restores the commit and index the operation started from." |
*
* @param {Conflict_Abort_DescriptionInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_abort_description = /** @type {((inputs?: Conflict_Abort_DescriptionInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conflict_Abort_DescriptionInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conflict_abort_description(inputs)
	return en_conflict_abort_description(inputs)
});