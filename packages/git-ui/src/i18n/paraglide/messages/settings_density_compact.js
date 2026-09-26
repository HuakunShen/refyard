/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Density_CompactInputs */

const en_settings_density_compact = /** @type {(inputs: Settings_Density_CompactInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`28px rows — the default, the most commits per screen`)
};

const zh_settings_density_compact = /** @type {(inputs: Settings_Density_CompactInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`28px 行 —— 默认,一屏容纳最多提交`)
};

/**
* | output |
* | --- |
* | "28px rows — the default, the most commits per screen" |
*
* @param {Settings_Density_CompactInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_density_compact = /** @type {((inputs?: Settings_Density_CompactInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Density_CompactInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_density_compact(inputs)
	return en_settings_density_compact(inputs)
});