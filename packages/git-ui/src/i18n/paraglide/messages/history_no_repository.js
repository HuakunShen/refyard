/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} History_No_RepositoryInputs */

const en_history_no_repository = /** @type {(inputs: History_No_RepositoryInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No repository selected`)
};

const zh_history_no_repository = /** @type {(inputs: History_No_RepositoryInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`未选择仓库`)
};

/**
* | output |
* | --- |
* | "No repository selected" |
*
* @param {History_No_RepositoryInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_no_repository = /** @type {((inputs?: History_No_RepositoryInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<History_No_RepositoryInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_history_no_repository(inputs)
	return en_history_no_repository(inputs)
});