/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_History_AriaInputs */

const en_commit_history_aria = /** @type {(inputs: Commit_History_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Commit history — arrow keys move the selection`)
};

const zh_commit_history_aria = /** @type {(inputs: Commit_History_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`提交历史 — 方向键移动选择`)
};

/**
* | output |
* | --- |
* | "Commit history — arrow keys move the selection" |
*
* @param {Commit_History_AriaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_history_aria = /** @type {((inputs?: Commit_History_AriaInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_History_AriaInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_history_aria(inputs)
	return en_commit_history_aria(inputs)
});