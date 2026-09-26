/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sidebar_SubmodulesInputs */

const en_sidebar_submodules = /** @type {(inputs: Sidebar_SubmodulesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Submodules`)
};

const zh_sidebar_submodules = /** @type {(inputs: Sidebar_SubmodulesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`子模块`)
};

/**
* | output |
* | --- |
* | "Submodules" |
*
* @param {Sidebar_SubmodulesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sidebar_submodules = /** @type {((inputs?: Sidebar_SubmodulesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sidebar_SubmodulesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_sidebar_submodules(inputs)
	return en_sidebar_submodules(inputs)
});