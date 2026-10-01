/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Delete_RefInputs */

const en_delete_ref = /** @type {(inputs: Delete_RefInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Delete ref`)
};

const zh_delete_ref = /** @type {(inputs: Delete_RefInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`删除引用`)
};

/**
* | output |
* | --- |
* | "Delete ref" |
*
* @param {Delete_RefInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const delete_ref = /** @type {((inputs?: Delete_RefInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Delete_RefInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_delete_ref(inputs)
	return en_delete_ref(inputs)
});