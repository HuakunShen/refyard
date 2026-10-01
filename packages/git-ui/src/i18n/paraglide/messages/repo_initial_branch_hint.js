/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Repo_Initial_Branch_HintInputs */

const en_repo_initial_branch_hint = /** @type {(inputs: Repo_Initial_Branch_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`initial branch (optional: Git's default)`)
};

const zh_repo_initial_branch_hint = /** @type {(inputs: Repo_Initial_Branch_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`初始分支(可选:Git 默认)`)
};

/**
* | output |
* | --- |
* | "initial branch (optional: Git's default)" |
*
* @param {Repo_Initial_Branch_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_initial_branch_hint = /** @type {((inputs?: Repo_Initial_Branch_HintInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Repo_Initial_Branch_HintInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_repo_initial_branch_hint(inputs)
	return en_repo_initial_branch_hint(inputs)
});