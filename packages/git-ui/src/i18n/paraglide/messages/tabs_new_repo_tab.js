/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Tabs_New_Repo_TabInputs */

const en_tabs_new_repo_tab = /** @type {(inputs: Tabs_New_Repo_TabInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`New repository tab`)
};

const zh_tabs_new_repo_tab = /** @type {(inputs: Tabs_New_Repo_TabInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`新建仓库标签页`)
};

/**
* | output |
* | --- |
* | "New repository tab" |
*
* @param {Tabs_New_Repo_TabInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const tabs_new_repo_tab = /** @type {((inputs?: Tabs_New_Repo_TabInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Tabs_New_Repo_TabInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_tabs_new_repo_tab(inputs)
	return en_tabs_new_repo_tab(inputs)
});