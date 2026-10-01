/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Err_Read_RefsInputs */

const en_err_read_refs = /** @type {(inputs: Err_Read_RefsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Could not read refs`)
};

const zh_err_read_refs = /** @type {(inputs: Err_Read_RefsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`无法读取引用`)
};

/**
* | output |
* | --- |
* | "Could not read refs" |
*
* @param {Err_Read_RefsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const err_read_refs = /** @type {((inputs?: Err_Read_RefsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Err_Read_RefsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_err_read_refs(inputs)
	return en_err_read_refs(inputs)
});