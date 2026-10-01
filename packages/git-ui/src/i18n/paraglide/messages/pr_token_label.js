/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Pr_Token_LabelInputs */

const en_pr_token_label = /** @type {(inputs: Pr_Token_LabelInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`GitHub personal access token`)
};

const zh_pr_token_label = /** @type {(inputs: Pr_Token_LabelInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`GitHub 个人访问令牌`)
};

/**
* | output |
* | --- |
* | "GitHub personal access token" |
*
* @param {Pr_Token_LabelInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pr_token_label = /** @type {((inputs?: Pr_Token_LabelInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Pr_Token_LabelInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_pr_token_label(inputs)
	return en_pr_token_label(inputs)
});