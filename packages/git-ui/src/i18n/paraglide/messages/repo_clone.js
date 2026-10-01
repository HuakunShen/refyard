/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Repo_CloneInputs */

const en_repo_clone = /** @type {(inputs: Repo_CloneInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Clone`)
};

const zh_repo_clone = /** @type {(inputs: Repo_CloneInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`克隆`)
};

/**
* | output |
* | --- |
* | "Clone" |
*
* @param {Repo_CloneInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_clone = /** @type {((inputs?: Repo_CloneInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Repo_CloneInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_repo_clone(inputs)
	return en_repo_clone(inputs)
});