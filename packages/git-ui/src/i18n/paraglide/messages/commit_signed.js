/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_SignedInputs */

const en_commit_signed = /** @type {(inputs: Commit_SignedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Commit carries a signature.`)
};

const zh_commit_signed = /** @type {(inputs: Commit_SignedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`提交带有签名。`)
};

/**
* | output |
* | --- |
* | "Commit carries a signature." |
*
* @param {Commit_SignedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_signed = /** @type {((inputs?: Commit_SignedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_SignedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_signed(inputs)
	return en_commit_signed(inputs)
});