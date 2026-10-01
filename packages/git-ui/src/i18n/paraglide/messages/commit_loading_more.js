/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_Loading_MoreInputs */

const en_commit_loading_more = /** @type {(inputs: Commit_Loading_MoreInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Loading more…`)
};

const zh_commit_loading_more = /** @type {(inputs: Commit_Loading_MoreInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`加载更多…`)
};

/**
* | output |
* | --- |
* | "Loading more…" |
*
* @param {Commit_Loading_MoreInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_loading_more = /** @type {((inputs?: Commit_Loading_MoreInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_Loading_MoreInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_loading_more(inputs)
	return en_commit_loading_more(inputs)
});