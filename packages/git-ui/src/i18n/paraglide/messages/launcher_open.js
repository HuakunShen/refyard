/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launcher_OpenInputs */

const en_launcher_open = /** @type {(inputs: Launcher_OpenInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Open a repository`)
};

const zh_launcher_open = /** @type {(inputs: Launcher_OpenInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`打开一个仓库`)
};

/**
* | output |
* | --- |
* | "Open a repository" |
*
* @param {Launcher_OpenInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_open = /** @type {((inputs?: Launcher_OpenInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launcher_OpenInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launcher_open(inputs)
	return en_launcher_open(inputs)
});