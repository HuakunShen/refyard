/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sidebar_RepositoriesInputs */

const en_sidebar_repositories = /** @type {(inputs: Sidebar_RepositoriesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Repositories`)
};

const zh_sidebar_repositories = /** @type {(inputs: Sidebar_RepositoriesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`仓库`)
};

/**
* | output |
* | --- |
* | "Repositories" |
*
* @param {Sidebar_RepositoriesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sidebar_repositories = /** @type {((inputs?: Sidebar_RepositoriesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sidebar_RepositoriesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_sidebar_repositories(inputs)
	return en_sidebar_repositories(inputs)
});