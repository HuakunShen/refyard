/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Err_List_ReposInputs */

const en_err_list_repos = /** @type {(inputs: Err_List_ReposInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Could not list repositories`)
};

const zh_err_list_repos = /** @type {(inputs: Err_List_ReposInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`无法列出仓库`)
};

/**
* | output |
* | --- |
* | "Could not list repositories" |
*
* @param {Err_List_ReposInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const err_list_repos = /** @type {((inputs?: Err_List_ReposInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Err_List_ReposInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_err_list_repos(inputs)
	return en_err_list_repos(inputs)
});