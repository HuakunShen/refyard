/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Submodule_NoneInputs */

const en_submodule_none = /** @type {(inputs: Submodule_NoneInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No submodules loaded.`)
};

const zh_submodule_none = /** @type {(inputs: Submodule_NoneInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`尚未加载任何子模块。`)
};

/**
* | output |
* | --- |
* | "No submodules loaded." |
*
* @param {Submodule_NoneInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const submodule_none = /** @type {((inputs?: Submodule_NoneInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Submodule_NoneInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_submodule_none(inputs)
	return en_submodule_none(inputs)
});