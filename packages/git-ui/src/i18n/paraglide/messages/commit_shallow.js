/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_ShallowInputs */

const en_commit_shallow = /** @type {(inputs: Commit_ShallowInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Shallow history`)
};

const zh_commit_shallow = /** @type {(inputs: Commit_ShallowInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`浅层历史`)
};

/**
* | output |
* | --- |
* | "Shallow history" |
*
* @param {Commit_ShallowInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_shallow = /** @type {((inputs?: Commit_ShallowInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_ShallowInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_shallow(inputs)
	return en_commit_shallow(inputs)
});