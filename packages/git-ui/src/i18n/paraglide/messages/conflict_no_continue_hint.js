/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Conflict_No_Continue_HintInputs */

const en_conflict_no_continue_hint = /** @type {(inputs: Conflict_No_Continue_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`This backend cannot continue this operation. Finish it with Git or the tool that started it.`)
};

const zh_conflict_no_continue_hint = /** @type {(inputs: Conflict_No_Continue_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`此后端不支持继续该操作。请使用 Git 或启动该操作的工具完成它。`)
};

/**
* | output |
* | --- |
* | "This backend cannot continue this operation. Finish it with Git or the tool that started it." |
*
* @param {Conflict_No_Continue_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_no_continue_hint = /** @type {((inputs?: Conflict_No_Continue_HintInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conflict_No_Continue_HintInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conflict_no_continue_hint(inputs)
	return en_conflict_no_continue_hint(inputs)
});