/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sidebar_No_ReposInputs */

const en_sidebar_no_repos = /** @type {(inputs: Sidebar_No_ReposInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No repositories`)
};

const zh_sidebar_no_repos = /** @type {(inputs: Sidebar_No_ReposInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`没有仓库`)
};

/**
* | output |
* | --- |
* | "No repositories" |
*
* @param {Sidebar_No_ReposInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sidebar_no_repos = /** @type {((inputs?: Sidebar_No_ReposInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sidebar_No_ReposInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_sidebar_no_repos(inputs)
	return en_sidebar_no_repos(inputs)
});