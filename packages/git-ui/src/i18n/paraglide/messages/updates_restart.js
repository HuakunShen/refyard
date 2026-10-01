/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Updates_RestartInputs */

const en_updates_restart = /** @type {(inputs: Updates_RestartInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Restart to finish`)
};

const zh_updates_restart = /** @type {(inputs: Updates_RestartInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`重启以完成`)
};

/**
* | output |
* | --- |
* | "Restart to finish" |
*
* @param {Updates_RestartInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const updates_restart = /** @type {((inputs?: Updates_RestartInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Updates_RestartInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_updates_restart(inputs)
	return en_updates_restart(inputs)
});