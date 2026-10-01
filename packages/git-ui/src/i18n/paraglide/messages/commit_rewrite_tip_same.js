/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_Rewrite_Tip_SameInputs */

const en_commit_rewrite_tip_same = /** @type {(inputs: Commit_Rewrite_Tip_SameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Rewrite the tip, same message`)
};

const zh_commit_rewrite_tip_same = /** @type {(inputs: Commit_Rewrite_Tip_SameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`重写顶端提交,保留信息`)
};

/**
* | output |
* | --- |
* | "Rewrite the tip, same message" |
*
* @param {Commit_Rewrite_Tip_SameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_rewrite_tip_same = /** @type {((inputs?: Commit_Rewrite_Tip_SameInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_Rewrite_Tip_SameInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_rewrite_tip_same(inputs)
	return en_commit_rewrite_tip_same(inputs)
});