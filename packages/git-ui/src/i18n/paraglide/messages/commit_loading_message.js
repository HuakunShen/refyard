/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_Loading_MessageInputs */

const en_commit_loading_message = /** @type {(inputs: Commit_Loading_MessageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Loading the full message…`)
};

const zh_commit_loading_message = /** @type {(inputs: Commit_Loading_MessageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`正在读取完整信息…`)
};

/**
* | output |
* | --- |
* | "Loading the full message…" |
*
* @param {Commit_Loading_MessageInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_loading_message = /** @type {((inputs?: Commit_Loading_MessageInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_Loading_MessageInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_loading_message(inputs)
	return en_commit_loading_message(inputs)
});