/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Remote_SyncInputs */

const en_remote_sync = /** @type {(inputs: Remote_SyncInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Sync`)
};

const zh_remote_sync = /** @type {(inputs: Remote_SyncInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`同步`)
};

/**
* | output |
* | --- |
* | "Sync" |
*
* @param {Remote_SyncInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_sync = /** @type {((inputs?: Remote_SyncInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Remote_SyncInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_remote_sync(inputs)
	return en_remote_sync(inputs)
});