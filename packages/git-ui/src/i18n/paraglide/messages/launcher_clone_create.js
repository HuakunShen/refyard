/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launcher_Clone_CreateInputs */

const en_launcher_clone_create = /** @type {(inputs: Launcher_Clone_CreateInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Clone / Create`)
};

const zh_launcher_clone_create = /** @type {(inputs: Launcher_Clone_CreateInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`克隆 / 创建`)
};

/**
* | output |
* | --- |
* | "Clone / Create" |
*
* @param {Launcher_Clone_CreateInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_clone_create = /** @type {((inputs?: Launcher_Clone_CreateInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launcher_Clone_CreateInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launcher_clone_create(inputs)
	return en_launcher_clone_create(inputs)
});