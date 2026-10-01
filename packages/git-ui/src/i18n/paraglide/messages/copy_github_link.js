/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Copy_Github_LinkInputs */

const en_copy_github_link = /** @type {(inputs: Copy_Github_LinkInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Copy GitHub link`)
};

const zh_copy_github_link = /** @type {(inputs: Copy_Github_LinkInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`复制 GitHub 链接`)
};

/**
* | output |
* | --- |
* | "Copy GitHub link" |
*
* @param {Copy_Github_LinkInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_github_link = /** @type {((inputs?: Copy_Github_LinkInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Copy_Github_LinkInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_copy_github_link(inputs)
	return en_copy_github_link(inputs)
});