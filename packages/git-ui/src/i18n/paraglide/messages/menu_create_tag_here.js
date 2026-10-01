/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Menu_Create_Tag_HereInputs */

const en_menu_create_tag_here = /** @type {(inputs: Menu_Create_Tag_HereInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Create Tag Here…`)
};

const zh_menu_create_tag_here = /** @type {(inputs: Menu_Create_Tag_HereInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`在此创建标签…`)
};

/**
* | output |
* | --- |
* | "Create Tag Here…" |
*
* @param {Menu_Create_Tag_HereInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_create_tag_here = /** @type {((inputs?: Menu_Create_Tag_HereInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Menu_Create_Tag_HereInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_menu_create_tag_here(inputs)
	return en_menu_create_tag_here(inputs)
});