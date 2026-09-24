/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Tab_NewInputs */

const en_tab_new = /** @type {(inputs: Tab_NewInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`New repository`)
};

const zh_tab_new = /** @type {(inputs: Tab_NewInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`新仓库`)
};

/**
* | output |
* | --- |
* | "New repository" |
*
* @param {Tab_NewInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const tab_new = /** @type {((inputs?: Tab_NewInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Tab_NewInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_tab_new(inputs)
	return en_tab_new(inputs)
});