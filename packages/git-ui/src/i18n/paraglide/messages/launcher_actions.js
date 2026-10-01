/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launcher_ActionsInputs */

const en_launcher_actions = /** @type {(inputs: Launcher_ActionsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Repository actions`)
};

const zh_launcher_actions = /** @type {(inputs: Launcher_ActionsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`仓库操作`)
};

/**
* | output |
* | --- |
* | "Repository actions" |
*
* @param {Launcher_ActionsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_actions = /** @type {((inputs?: Launcher_ActionsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launcher_ActionsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launcher_actions(inputs)
	return en_launcher_actions(inputs)
});