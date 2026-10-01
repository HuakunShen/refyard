/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Submodule_AddInputs */

const en_submodule_add = /** @type {(inputs: Submodule_AddInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Add submodule`)
};

const zh_submodule_add = /** @type {(inputs: Submodule_AddInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`添加子模块`)
};

/**
* | output |
* | --- |
* | "Add submodule" |
*
* @param {Submodule_AddInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const submodule_add = /** @type {((inputs?: Submodule_AddInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Submodule_AddInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_submodule_add(inputs)
	return en_submodule_add(inputs)
});