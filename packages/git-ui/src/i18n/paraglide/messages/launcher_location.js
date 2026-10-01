/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launcher_LocationInputs */

const en_launcher_location = /** @type {(inputs: Launcher_LocationInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Location`)
};

const zh_launcher_location = /** @type {(inputs: Launcher_LocationInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`位置`)
};

/**
* | output |
* | --- |
* | "Location" |
*
* @param {Launcher_LocationInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_location = /** @type {((inputs?: Launcher_LocationInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launcher_LocationInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launcher_location(inputs)
	return en_launcher_location(inputs)
});