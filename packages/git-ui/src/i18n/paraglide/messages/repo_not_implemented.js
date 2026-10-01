/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Repo_Not_ImplementedInputs */

const en_repo_not_implemented = /** @type {(inputs: Repo_Not_ImplementedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`not implemented in this build`)
};

const zh_repo_not_implemented = /** @type {(inputs: Repo_Not_ImplementedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`此构建未实现`)
};

/**
* | output |
* | --- |
* | "not implemented in this build" |
*
* @param {Repo_Not_ImplementedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_not_implemented = /** @type {((inputs?: Repo_Not_ImplementedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Repo_Not_ImplementedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_repo_not_implemented(inputs)
	return en_repo_not_implemented(inputs)
});