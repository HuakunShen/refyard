/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launch_RefusedInputs */

const en_launch_refused = /** @type {(inputs: Launch_RefusedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Refyard could not open a directory from the command line`)
};

const zh_launch_refused = /** @type {(inputs: Launch_RefusedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Refyard 无法打开命令行给出的目录`)
};

/**
* | output |
* | --- |
* | "Refyard could not open a directory from the command line" |
*
* @param {Launch_RefusedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launch_refused = /** @type {((inputs?: Launch_RefusedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launch_RefusedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launch_refused(inputs)
	return en_launch_refused(inputs)
});