/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Pr_Token_PlaceholderInputs */

const en_pr_token_placeholder = /** @type {(inputs: Pr_Token_PlaceholderInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`GitHub token (github_pat_… or ghp_…)`)
};

const zh_pr_token_placeholder = /** @type {(inputs: Pr_Token_PlaceholderInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`GitHub 令牌(github_pat_… 或 ghp_…)`)
};

/**
* | output |
* | --- |
* | "GitHub token (github_pat_… or ghp_…)" |
*
* @param {Pr_Token_PlaceholderInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pr_token_placeholder = /** @type {((inputs?: Pr_Token_PlaceholderInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Pr_Token_PlaceholderInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_pr_token_placeholder(inputs)
	return en_pr_token_placeholder(inputs)
});