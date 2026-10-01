/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Repo_Init_SubmodulesInputs */

const en_repo_init_submodules = /** @type {(inputs: Repo_Init_SubmodulesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Initialise submodules`)
};

const zh_repo_init_submodules = /** @type {(inputs: Repo_Init_SubmodulesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`初始化子模块`)
};

/**
* | output |
* | --- |
* | "Initialise submodules" |
*
* @param {Repo_Init_SubmodulesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_init_submodules = /** @type {((inputs?: Repo_Init_SubmodulesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Repo_Init_SubmodulesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_repo_init_submodules(inputs)
	return en_repo_init_submodules(inputs)
});