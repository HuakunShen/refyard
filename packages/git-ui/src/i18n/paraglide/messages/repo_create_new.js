/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Repo_Create_NewInputs */

const en_repo_create_new = /** @type {(inputs: Repo_Create_NewInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Create new`)
};

const zh_repo_create_new = /** @type {(inputs: Repo_Create_NewInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`新建`)
};

/**
* | output |
* | --- |
* | "Create new" |
*
* @param {Repo_Create_NewInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_create_new = /** @type {((inputs?: Repo_Create_NewInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Repo_Create_NewInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_repo_create_new(inputs)
	return en_repo_create_new(inputs)
});