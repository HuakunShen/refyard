/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ ops: NonNullable<unknown> }} Header_Write_Ops_TitleInputs */

const en_header_write_ops_title = /** @type {(inputs: Header_Write_Ops_TitleInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Implemented write operations: ${i?.ops}`)
};

const zh_header_write_ops_title = /** @type {(inputs: Header_Write_Ops_TitleInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`已实现的写入操作:${i?.ops}`)
};

/**
* | output |
* | --- |
* | "Implemented write operations: {ops}" |
*
* @param {Header_Write_Ops_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const header_write_ops_title = /** @type {((inputs: Header_Write_Ops_TitleInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Header_Write_Ops_TitleInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_header_write_ops_title(inputs)
	return en_header_write_ops_title(inputs)
});