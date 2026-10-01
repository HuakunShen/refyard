/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Repo_Remote_UrlInputs */

const en_repo_remote_url = /** @type {(inputs: Repo_Remote_UrlInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`remote URL`)
};

const zh_repo_remote_url = /** @type {(inputs: Repo_Remote_UrlInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`远程地址`)
};

/**
* | output |
* | --- |
* | "remote URL" |
*
* @param {Repo_Remote_UrlInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_remote_url = /** @type {((inputs?: Repo_Remote_UrlInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Repo_Remote_UrlInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_repo_remote_url(inputs)
	return en_repo_remote_url(inputs)
});