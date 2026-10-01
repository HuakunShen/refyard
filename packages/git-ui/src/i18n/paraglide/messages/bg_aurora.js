/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Bg_AuroraInputs */

const en_bg_aurora = /** @type {(inputs: Bg_AuroraInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Dark Aurora`)
};

const zh_bg_aurora = /** @type {(inputs: Bg_AuroraInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`暗夜极光`)
};

/**
* | output |
* | --- |
* | "Dark Aurora" |
*
* @param {Bg_AuroraInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const bg_aurora = /** @type {((inputs?: Bg_AuroraInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Bg_AuroraInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_bg_aurora(inputs)
	return en_bg_aurora(inputs)
});