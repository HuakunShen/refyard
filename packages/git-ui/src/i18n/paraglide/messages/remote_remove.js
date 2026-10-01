/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Remote_RemoveInputs */

const en_remote_remove = /** @type {(inputs: Remote_RemoveInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Remove remote`)
};

const zh_remote_remove = /** @type {(inputs: Remote_RemoveInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`移除远程`)
};

/**
* | output |
* | --- |
* | "Remove remote" |
*
* @param {Remote_RemoveInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_remove = /** @type {((inputs?: Remote_RemoveInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Remote_RemoveInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_remote_remove(inputs)
	return en_remote_remove(inputs)
});