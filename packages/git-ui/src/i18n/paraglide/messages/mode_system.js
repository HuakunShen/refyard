/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Mode_SystemInputs */

const en_mode_system = /** @type {(inputs: Mode_SystemInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`System`)
};

const zh_mode_system = /** @type {(inputs: Mode_SystemInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`跟随系统`)
};

/**
* | output |
* | --- |
* | "System" |
*
* @param {Mode_SystemInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const mode_system = /** @type {((inputs?: Mode_SystemInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Mode_SystemInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_mode_system(inputs)
	return en_mode_system(inputs)
});