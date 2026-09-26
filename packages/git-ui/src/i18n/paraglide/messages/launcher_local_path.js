/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launcher_Local_PathInputs */

const en_launcher_local_path = /** @type {(inputs: Launcher_Local_PathInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Local repository path`)
};

const zh_launcher_local_path = /** @type {(inputs: Launcher_Local_PathInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`本地仓库路径`)
};

/**
* | output |
* | --- |
* | "Local repository path" |
*
* @param {Launcher_Local_PathInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_local_path = /** @type {((inputs?: Launcher_Local_PathInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launcher_Local_PathInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launcher_local_path(inputs)
	return en_launcher_local_path(inputs)
});