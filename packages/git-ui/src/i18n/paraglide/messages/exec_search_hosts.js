/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Exec_Search_HostsInputs */

const en_exec_search_hosts = /** @type {(inputs: Exec_Search_HostsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Search hosts by name, label or source`)
};

const zh_exec_search_hosts = /** @type {(inputs: Exec_Search_HostsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`按名称、标签或来源搜索主机`)
};

/**
* | output |
* | --- |
* | "Search hosts by name, label or source" |
*
* @param {Exec_Search_HostsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const exec_search_hosts = /** @type {((inputs?: Exec_Search_HostsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Exec_Search_HostsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_exec_search_hosts(inputs)
	return en_exec_search_hosts(inputs)
});