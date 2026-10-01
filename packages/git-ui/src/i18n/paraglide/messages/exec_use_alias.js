/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Exec_Use_AliasInputs */

const en_exec_use_alias = /** @type {(inputs: Exec_Use_AliasInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Use alias`)
};

const zh_exec_use_alias = /** @type {(inputs: Exec_Use_AliasInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`使用别名`)
};

/**
* | output |
* | --- |
* | "Use alias" |
*
* @param {Exec_Use_AliasInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const exec_use_alias = /** @type {((inputs?: Exec_Use_AliasInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Exec_Use_AliasInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_exec_use_alias(inputs)
	return en_exec_use_alias(inputs)
});