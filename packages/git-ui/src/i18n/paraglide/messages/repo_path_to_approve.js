/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Repo_Path_To_ApproveInputs */

const en_repo_path_to_approve = /** @type {(inputs: Repo_Path_To_ApproveInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`repository path to approve`)
};

const zh_repo_path_to_approve = /** @type {(inputs: Repo_Path_To_ApproveInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`要批准的仓库路径`)
};

/**
* | output |
* | --- |
* | "repository path to approve" |
*
* @param {Repo_Path_To_ApproveInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_path_to_approve = /** @type {((inputs?: Repo_Path_To_ApproveInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Repo_Path_To_ApproveInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_repo_path_to_approve(inputs)
	return en_repo_path_to_approve(inputs)
});