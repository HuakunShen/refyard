/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Menu_Delete_RefInputs */

const en_menu_delete_ref = /** @type {(inputs: Menu_Delete_RefInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Delete…`)
};

const zh_menu_delete_ref = /** @type {(inputs: Menu_Delete_RefInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`删除…`)
};

/**
* | output |
* | --- |
* | "Delete…" |
*
* @param {Menu_Delete_RefInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_delete_ref = /** @type {((inputs?: Menu_Delete_RefInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Menu_Delete_RefInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_menu_delete_ref(inputs)
	return en_menu_delete_ref(inputs)
});