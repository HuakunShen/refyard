/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_Keep_MessageInputs */

const en_commit_keep_message = /** @type {(inputs: Commit_Keep_MessageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`keep the existing message`)
};

const zh_commit_keep_message = /** @type {(inputs: Commit_Keep_MessageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`保留现有提交信息`)
};

/**
* | output |
* | --- |
* | "keep the existing message" |
*
* @param {Commit_Keep_MessageInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_keep_message = /** @type {((inputs?: Commit_Keep_MessageInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_Keep_MessageInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_keep_message(inputs)
	return en_commit_keep_message(inputs)
});