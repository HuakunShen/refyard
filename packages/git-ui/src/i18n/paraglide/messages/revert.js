/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} RevertInputs */

const en_revert = /** @type {(inputs: RevertInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Revert`)
};

const zh_revert = /** @type {(inputs: RevertInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`还原`)
};

/**
* | output |
* | --- |
* | "Revert" |
*
* @param {RevertInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const revert = /** @type {((inputs?: RevertInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<RevertInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_revert(inputs)
	return en_revert(inputs)
});