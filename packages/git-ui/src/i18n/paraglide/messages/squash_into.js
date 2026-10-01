/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Squash_IntoInputs */

const en_squash_into = /** @type {(inputs: Squash_IntoInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Squash into parent`)
};

const zh_squash_into = /** @type {(inputs: Squash_IntoInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`并入父提交`)
};

/**
* | output |
* | --- |
* | "Squash into parent" |
*
* @param {Squash_IntoInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const squash_into = /** @type {((inputs?: Squash_IntoInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Squash_IntoInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_squash_into(inputs)
	return en_squash_into(inputs)
});