/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Repo_CreateInputs */

const en_repo_create = /** @type {(inputs: Repo_CreateInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Create repository`)
};

const zh_repo_create = /** @type {(inputs: Repo_CreateInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`创建仓库`)
};

/**
* | output |
* | --- |
* | "Create repository" |
*
* @param {Repo_CreateInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_create = /** @type {((inputs?: Repo_CreateInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Repo_CreateInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_repo_create(inputs)
	return en_repo_create(inputs)
});