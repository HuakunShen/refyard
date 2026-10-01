/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Branch_SwitchInputs */

const en_branch_switch = /** @type {(inputs: Branch_SwitchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Switch`)
};

const zh_branch_switch = /** @type {(inputs: Branch_SwitchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`切换`)
};

/**
* | output |
* | --- |
* | "Switch" |
*
* @param {Branch_SwitchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_switch = /** @type {((inputs?: Branch_SwitchInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Branch_SwitchInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_branch_switch(inputs)
	return en_branch_switch(inputs)
});