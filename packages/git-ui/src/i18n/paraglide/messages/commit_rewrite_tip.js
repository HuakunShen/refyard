/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_Rewrite_TipInputs */

const en_commit_rewrite_tip = /** @type {(inputs: Commit_Rewrite_TipInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Rewrite the tip commit`)
};

const zh_commit_rewrite_tip = /** @type {(inputs: Commit_Rewrite_TipInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`重写顶端提交`)
};

/**
* | output |
* | --- |
* | "Rewrite the tip commit" |
*
* @param {Commit_Rewrite_TipInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_rewrite_tip = /** @type {((inputs?: Commit_Rewrite_TipInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_Rewrite_TipInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_rewrite_tip(inputs)
	return en_commit_rewrite_tip(inputs)
});