/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Err_Read_SubmodulesInputs */

const en_err_read_submodules = /** @type {(inputs: Err_Read_SubmodulesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Could not read submodules`)
};

const zh_err_read_submodules = /** @type {(inputs: Err_Read_SubmodulesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`无法读取子模块`)
};

/**
* | output |
* | --- |
* | "Could not read submodules" |
*
* @param {Err_Read_SubmodulesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const err_read_submodules = /** @type {((inputs?: Err_Read_SubmodulesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Err_Read_SubmodulesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_err_read_submodules(inputs)
	return en_err_read_submodules(inputs)
});