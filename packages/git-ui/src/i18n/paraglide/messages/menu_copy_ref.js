/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ ref: NonNullable<unknown> }} Menu_Copy_RefInputs */

const en_menu_copy_ref = /** @type {(inputs: Menu_Copy_RefInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Copy ${i?.ref}`)
};

const zh_menu_copy_ref = /** @type {(inputs: Menu_Copy_RefInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`复制 ${i?.ref}`)
};

/**
* | output |
* | --- |
* | "Copy {ref}" |
*
* @param {Menu_Copy_RefInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_copy_ref = /** @type {((inputs: Menu_Copy_RefInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Menu_Copy_RefInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_menu_copy_ref(inputs)
	return en_menu_copy_ref(inputs)
});