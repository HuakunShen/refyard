/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Loading_ReposInputs */

const en_loading_repos = /** @type {(inputs: Loading_ReposInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Loading repositories…`)
};

const zh_loading_repos = /** @type {(inputs: Loading_ReposInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`正在加载仓库…`)
};

/**
* | output |
* | --- |
* | "Loading repositories…" |
*
* @param {Loading_ReposInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const loading_repos = /** @type {((inputs?: Loading_ReposInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Loading_ReposInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_loading_repos(inputs)
	return en_loading_repos(inputs)
});