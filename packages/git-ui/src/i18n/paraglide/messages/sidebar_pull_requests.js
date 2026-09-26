/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sidebar_Pull_RequestsInputs */

const en_sidebar_pull_requests = /** @type {(inputs: Sidebar_Pull_RequestsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Pull Requests`)
};

const zh_sidebar_pull_requests = /** @type {(inputs: Sidebar_Pull_RequestsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Pull Request`)
};

/**
* | output |
* | --- |
* | "Pull Requests" |
*
* @param {Sidebar_Pull_RequestsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sidebar_pull_requests = /** @type {((inputs?: Sidebar_Pull_RequestsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sidebar_Pull_RequestsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_sidebar_pull_requests(inputs)
	return en_sidebar_pull_requests(inputs)
});