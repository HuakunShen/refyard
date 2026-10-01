/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Exec_IncompleteInputs */

const en_exec_incomplete = /** @type {(inputs: Exec_IncompleteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`incomplete`)
};

const zh_exec_incomplete = /** @type {(inputs: Exec_IncompleteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`不完整`)
};

/**
* | output |
* | --- |
* | "incomplete" |
*
* @param {Exec_IncompleteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const exec_incomplete = /** @type {((inputs?: Exec_IncompleteInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Exec_IncompleteInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_exec_incomplete(inputs)
	return en_exec_incomplete(inputs)
});