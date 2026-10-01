/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Copy_Uncommitted_HintInputs */

const en_copy_uncommitted_hint = /** @type {(inputs: Copy_Uncommitted_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`uncommitted changes — click to work on them`)
};

const zh_copy_uncommitted_hint = /** @type {(inputs: Copy_Uncommitted_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`有未提交的变更 — 点击处理`)
};

/**
* | output |
* | --- |
* | "uncommitted changes — click to work on them" |
*
* @param {Copy_Uncommitted_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_uncommitted_hint = /** @type {((inputs?: Copy_Uncommitted_HintInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Copy_Uncommitted_HintInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_copy_uncommitted_hint(inputs)
	return en_copy_uncommitted_hint(inputs)
});