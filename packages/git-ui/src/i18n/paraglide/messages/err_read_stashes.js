/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Err_Read_StashesInputs */

const en_err_read_stashes = /** @type {(inputs: Err_Read_StashesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Could not read stashes`)
};

const zh_err_read_stashes = /** @type {(inputs: Err_Read_StashesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`无法读取贮藏`)
};

/**
* | output |
* | --- |
* | "Could not read stashes" |
*
* @param {Err_Read_StashesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const err_read_stashes = /** @type {((inputs?: Err_Read_StashesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Err_Read_StashesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_err_read_stashes(inputs)
	return en_err_read_stashes(inputs)
});