/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Repo_Approved_RootInputs */

const en_repo_approved_root = /** @type {(inputs: Repo_Approved_RootInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`approved root`)
};

const zh_repo_approved_root = /** @type {(inputs: Repo_Approved_RootInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`已批准的根目录`)
};

/**
* | output |
* | --- |
* | "approved root" |
*
* @param {Repo_Approved_RootInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_approved_root = /** @type {((inputs?: Repo_Approved_RootInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Repo_Approved_RootInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_repo_approved_root(inputs)
	return en_repo_approved_root(inputs)
});