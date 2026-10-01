/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Repo_What_To_CreateInputs */

const en_repo_what_to_create = /** @type {(inputs: Repo_What_To_CreateInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`what to create`)
};

const zh_repo_what_to_create = /** @type {(inputs: Repo_What_To_CreateInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`创建什么`)
};

/**
* | output |
* | --- |
* | "what to create" |
*
* @param {Repo_What_To_CreateInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_what_to_create = /** @type {((inputs?: Repo_What_To_CreateInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Repo_What_To_CreateInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_repo_what_to_create(inputs)
	return en_repo_what_to_create(inputs)
});