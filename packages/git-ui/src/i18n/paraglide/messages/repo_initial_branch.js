/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Repo_Initial_BranchInputs */

const en_repo_initial_branch = /** @type {(inputs: Repo_Initial_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`initial branch`)
};

const zh_repo_initial_branch = /** @type {(inputs: Repo_Initial_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`初始分支`)
};

/**
* | output |
* | --- |
* | "initial branch" |
*
* @param {Repo_Initial_BranchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_initial_branch = /** @type {((inputs?: Repo_Initial_BranchInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Repo_Initial_BranchInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_repo_initial_branch(inputs)
	return en_repo_initial_branch(inputs)
});