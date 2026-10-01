/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launcher_Search_RecentInputs */

const en_launcher_search_recent = /** @type {(inputs: Launcher_Search_RecentInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Search recent repositories`)
};

const zh_launcher_search_recent = /** @type {(inputs: Launcher_Search_RecentInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`搜索最近仓库`)
};

/**
* | output |
* | --- |
* | "Search recent repositories" |
*
* @param {Launcher_Search_RecentInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_search_recent = /** @type {((inputs?: Launcher_Search_RecentInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launcher_Search_RecentInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launcher_search_recent(inputs)
	return en_launcher_search_recent(inputs)
});