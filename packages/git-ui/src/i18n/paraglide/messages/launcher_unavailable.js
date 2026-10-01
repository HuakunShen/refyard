/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launcher_UnavailableInputs */

const en_launcher_unavailable = /** @type {(inputs: Launcher_UnavailableInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`unavailable`)
};

const zh_launcher_unavailable = /** @type {(inputs: Launcher_UnavailableInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`不可用`)
};

/**
* | output |
* | --- |
* | "unavailable" |
*
* @param {Launcher_UnavailableInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_unavailable = /** @type {((inputs?: Launcher_UnavailableInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launcher_UnavailableInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launcher_unavailable(inputs)
	return en_launcher_unavailable(inputs)
});