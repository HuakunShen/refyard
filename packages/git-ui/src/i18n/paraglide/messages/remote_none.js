/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Remote_NoneInputs */

const en_remote_none = /** @type {(inputs: Remote_NoneInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No remotes configured.`)
};

const zh_remote_none = /** @type {(inputs: Remote_NoneInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`尚未配置远程。`)
};

/**
* | output |
* | --- |
* | "No remotes configured." |
*
* @param {Remote_NoneInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_none = /** @type {((inputs?: Remote_NoneInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Remote_NoneInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_remote_none(inputs)
	return en_remote_none(inputs)
});