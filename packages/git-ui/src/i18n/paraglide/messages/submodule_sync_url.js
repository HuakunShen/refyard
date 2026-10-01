/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Submodule_Sync_UrlInputs */

const en_submodule_sync_url = /** @type {(inputs: Submodule_Sync_UrlInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Sync URL`)
};

const zh_submodule_sync_url = /** @type {(inputs: Submodule_Sync_UrlInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`同步 URL`)
};

/**
* | output |
* | --- |
* | "Sync URL" |
*
* @param {Submodule_Sync_UrlInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const submodule_sync_url = /** @type {((inputs?: Submodule_Sync_UrlInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Submodule_Sync_UrlInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_submodule_sync_url(inputs)
	return en_submodule_sync_url(inputs)
});