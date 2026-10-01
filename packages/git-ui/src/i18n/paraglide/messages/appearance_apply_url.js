/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Appearance_Apply_UrlInputs */

const en_appearance_apply_url = /** @type {(inputs: Appearance_Apply_UrlInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Apply URL`)
};

const zh_appearance_apply_url = /** @type {(inputs: Appearance_Apply_UrlInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`应用 URL`)
};

/**
* | output |
* | --- |
* | "Apply URL" |
*
* @param {Appearance_Apply_UrlInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_apply_url = /** @type {((inputs?: Appearance_Apply_UrlInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Appearance_Apply_UrlInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_appearance_apply_url(inputs)
	return en_appearance_apply_url(inputs)
});