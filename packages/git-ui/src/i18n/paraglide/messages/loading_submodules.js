/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Loading_SubmodulesInputs */

const en_loading_submodules = /** @type {(inputs: Loading_SubmodulesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Reading submodules…`)
};

const zh_loading_submodules = /** @type {(inputs: Loading_SubmodulesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`正在读取子模块…`)
};

/**
* | output |
* | --- |
* | "Reading submodules…" |
*
* @param {Loading_SubmodulesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const loading_submodules = /** @type {((inputs?: Loading_SubmodulesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Loading_SubmodulesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_loading_submodules(inputs)
	return en_loading_submodules(inputs)
});