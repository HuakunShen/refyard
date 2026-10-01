/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Resize_Repo_ListInputs */

const en_resize_repo_list = /** @type {(inputs: Resize_Repo_ListInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Repository list height`)
};

const zh_resize_repo_list = /** @type {(inputs: Resize_Repo_ListInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`仓库列表高度`)
};

/**
* | output |
* | --- |
* | "Repository list height" |
*
* @param {Resize_Repo_ListInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const resize_repo_list = /** @type {((inputs?: Resize_Repo_ListInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Resize_Repo_ListInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_resize_repo_list(inputs)
	return en_resize_repo_list(inputs)
});