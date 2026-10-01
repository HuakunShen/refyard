/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Repo_No_Ops_ReportedInputs */

const en_repo_no_ops_reported = /** @type {(inputs: Repo_No_Ops_ReportedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`the service has not reported its operations`)
};

const zh_repo_no_ops_reported = /** @type {(inputs: Repo_No_Ops_ReportedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`服务未上报其操作`)
};

/**
* | output |
* | --- |
* | "the service has not reported its operations" |
*
* @param {Repo_No_Ops_ReportedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_no_ops_reported = /** @type {((inputs?: Repo_No_Ops_ReportedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Repo_No_Ops_ReportedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_repo_no_ops_reported(inputs)
	return en_repo_no_ops_reported(inputs)
});