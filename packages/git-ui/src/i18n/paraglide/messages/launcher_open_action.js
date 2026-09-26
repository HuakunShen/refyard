/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launcher_Open_ActionInputs */

const en_launcher_open_action = /** @type {(inputs: Launcher_Open_ActionInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Open`)
};

const zh_launcher_open_action = /** @type {(inputs: Launcher_Open_ActionInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`打开`)
};

/**
* | output |
* | --- |
* | "Open" |
*
* @param {Launcher_Open_ActionInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_open_action = /** @type {((inputs?: Launcher_Open_ActionInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launcher_Open_ActionInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launcher_open_action(inputs)
	return en_launcher_open_action(inputs)
});