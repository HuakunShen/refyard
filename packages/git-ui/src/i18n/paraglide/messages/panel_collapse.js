/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Panel_CollapseInputs */

const en_panel_collapse = /** @type {(inputs: Panel_CollapseInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Collapse repository panel`)
};

const zh_panel_collapse = /** @type {(inputs: Panel_CollapseInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`收起仓库面板`)
};

/**
* | output |
* | --- |
* | "Collapse repository panel" |
*
* @param {Panel_CollapseInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const panel_collapse = /** @type {((inputs?: Panel_CollapseInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Panel_CollapseInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_panel_collapse(inputs)
	return en_panel_collapse(inputs)
});