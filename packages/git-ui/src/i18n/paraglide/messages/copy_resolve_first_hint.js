/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Copy_Resolve_First_HintInputs */

const en_copy_resolve_first_hint = /** @type {(inputs: Copy_Resolve_First_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Resolve and stage every conflicted file before committing.`)
};

const zh_copy_resolve_first_hint = /** @type {(inputs: Copy_Resolve_First_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`提交前请先解决并暂存所有冲突文件。`)
};

/**
* | output |
* | --- |
* | "Resolve and stage every conflicted file before committing." |
*
* @param {Copy_Resolve_First_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_resolve_first_hint = /** @type {((inputs?: Copy_Resolve_First_HintInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Copy_Resolve_First_HintInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_copy_resolve_first_hint(inputs)
	return en_copy_resolve_first_hint(inputs)
});