/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launcher_Reading_DirsInputs */

const en_launcher_reading_dirs = /** @type {(inputs: Launcher_Reading_DirsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Reading directories…`)
};

const zh_launcher_reading_dirs = /** @type {(inputs: Launcher_Reading_DirsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`正在读取目录…`)
};

/**
* | output |
* | --- |
* | "Reading directories…" |
*
* @param {Launcher_Reading_DirsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_reading_dirs = /** @type {((inputs?: Launcher_Reading_DirsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launcher_Reading_DirsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launcher_reading_dirs(inputs)
	return en_launcher_reading_dirs(inputs)
});