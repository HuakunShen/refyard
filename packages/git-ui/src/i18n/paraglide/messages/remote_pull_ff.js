/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Remote_Pull_FfInputs */

const en_remote_pull_ff = /** @type {(inputs: Remote_Pull_FfInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Pull (ff-only)`)
};

const zh_remote_pull_ff = /** @type {(inputs: Remote_Pull_FfInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`拉取(仅快进)`)
};

/**
* | output |
* | --- |
* | "Pull (ff-only)" |
*
* @param {Remote_Pull_FfInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_pull_ff = /** @type {((inputs?: Remote_Pull_FfInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Remote_Pull_FfInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_remote_pull_ff(inputs)
	return en_remote_pull_ff(inputs)
});