/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_Select_PromptInputs */

const en_commit_select_prompt = /** @type {(inputs: Commit_Select_PromptInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Select a commit to read it.`)
};

const zh_commit_select_prompt = /** @type {(inputs: Commit_Select_PromptInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`选择一个提交以查看。`)
};

/**
* | output |
* | --- |
* | "Select a commit to read it." |
*
* @param {Commit_Select_PromptInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_select_prompt = /** @type {((inputs?: Commit_Select_PromptInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_Select_PromptInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_select_prompt(inputs)
	return en_commit_select_prompt(inputs)
});