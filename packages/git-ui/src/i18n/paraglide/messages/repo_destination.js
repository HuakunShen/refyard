/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Repo_DestinationInputs */

const en_repo_destination = /** @type {(inputs: Repo_DestinationInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`repository destination`)
};

const zh_repo_destination = /** @type {(inputs: Repo_DestinationInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`仓库目标位置`)
};

/**
* | output |
* | --- |
* | "repository destination" |
*
* @param {Repo_DestinationInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_destination = /** @type {((inputs?: Repo_DestinationInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Repo_DestinationInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_repo_destination(inputs)
	return en_repo_destination(inputs)
});