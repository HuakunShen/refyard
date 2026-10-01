/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Remote_AddInputs */

const en_remote_add = /** @type {(inputs: Remote_AddInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Add remote`)
};

const zh_remote_add = /** @type {(inputs: Remote_AddInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`添加远程`)
};

/**
* | output |
* | --- |
* | "Add remote" |
*
* @param {Remote_AddInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_add = /** @type {((inputs?: Remote_AddInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Remote_AddInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_remote_add(inputs)
	return en_remote_add(inputs)
});