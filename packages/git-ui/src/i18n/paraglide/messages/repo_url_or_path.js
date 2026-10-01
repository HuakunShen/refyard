/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Repo_Url_Or_PathInputs */

const en_repo_url_or_path = /** @type {(inputs: Repo_Url_Or_PathInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`https://host/project.git or an approved local path`)
};

const zh_repo_url_or_path = /** @type {(inputs: Repo_Url_Or_PathInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`https://host/project.git 或已批准的本地路径`)
};

/**
* | output |
* | --- |
* | "https://host/project.git or an approved local path" |
*
* @param {Repo_Url_Or_PathInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_url_or_path = /** @type {((inputs?: Repo_Url_Or_PathInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Repo_Url_Or_PathInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_repo_url_or_path(inputs)
	return en_repo_url_or_path(inputs)
});