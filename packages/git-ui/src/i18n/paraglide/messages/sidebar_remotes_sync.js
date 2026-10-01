/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sidebar_Remotes_SyncInputs */

const en_sidebar_remotes_sync = /** @type {(inputs: Sidebar_Remotes_SyncInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Remotes & sync`)
};

const zh_sidebar_remotes_sync = /** @type {(inputs: Sidebar_Remotes_SyncInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`远程与同步`)
};

/**
* | output |
* | --- |
* | "Remotes & sync" |
*
* @param {Sidebar_Remotes_SyncInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sidebar_remotes_sync = /** @type {((inputs?: Sidebar_Remotes_SyncInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sidebar_Remotes_SyncInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_sidebar_remotes_sync(inputs)
	return en_sidebar_remotes_sync(inputs)
});