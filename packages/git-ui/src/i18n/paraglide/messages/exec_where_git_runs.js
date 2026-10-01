/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Exec_Where_Git_RunsInputs */

const en_exec_where_git_runs = /** @type {(inputs: Exec_Where_Git_RunsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Where should Git run?`)
};

const zh_exec_where_git_runs = /** @type {(inputs: Exec_Where_Git_RunsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Git 应该在哪里运行?`)
};

/**
* | output |
* | --- |
* | "Where should Git run?" |
*
* @param {Exec_Where_Git_RunsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const exec_where_git_runs = /** @type {((inputs?: Exec_Where_Git_RunsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Exec_Where_Git_RunsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_exec_where_git_runs(inputs)
	return en_exec_where_git_runs(inputs)
});