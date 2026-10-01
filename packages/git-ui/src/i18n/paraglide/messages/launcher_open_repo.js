/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launcher_Open_RepoInputs */

const en_launcher_open_repo = /** @type {(inputs: Launcher_Open_RepoInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Open repository`)
};

const zh_launcher_open_repo = /** @type {(inputs: Launcher_Open_RepoInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`打开仓库`)
};

/**
* | output |
* | --- |
* | "Open repository" |
*
* @param {Launcher_Open_RepoInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_open_repo = /** @type {((inputs?: Launcher_Open_RepoInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launcher_Open_RepoInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launcher_open_repo(inputs)
	return en_launcher_open_repo(inputs)
});