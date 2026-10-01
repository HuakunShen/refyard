/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ n: NonNullable<unknown> }} Header_N_Write_OpsInputs */

const en_header_n_write_ops = /** @type {(inputs: Header_N_Write_OpsInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`${i?.n} write operations`)
};

const zh_header_n_write_ops = /** @type {(inputs: Header_N_Write_OpsInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`${i?.n} 项写入操作`)
};

/**
* | output |
* | --- |
* | "{n} write operations" |
*
* @param {Header_N_Write_OpsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const header_n_write_ops = /** @type {((inputs: Header_N_Write_OpsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Header_N_Write_OpsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_header_n_write_ops(inputs)
	return en_header_n_write_ops(inputs)
});