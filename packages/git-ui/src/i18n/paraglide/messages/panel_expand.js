/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Panel_ExpandInputs */

const en_panel_expand = /** @type {(inputs: Panel_ExpandInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Expand repository panel`)
};

const zh_panel_expand = /** @type {(inputs: Panel_ExpandInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`展开仓库面板`)
};

/**
* | output |
* | --- |
* | "Expand repository panel" |
*
* @param {Panel_ExpandInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const panel_expand = /** @type {((inputs?: Panel_ExpandInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Panel_ExpandInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_panel_expand(inputs)
	return en_panel_expand(inputs)
});