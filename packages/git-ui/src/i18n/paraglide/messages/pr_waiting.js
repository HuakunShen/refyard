/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Pr_WaitingInputs */

const en_pr_waiting = /** @type {(inputs: Pr_WaitingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Waiting for authorization…`)
};

const zh_pr_waiting = /** @type {(inputs: Pr_WaitingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`等待授权…`)
};

/**
* | output |
* | --- |
* | "Waiting for authorization…" |
*
* @param {Pr_WaitingInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pr_waiting = /** @type {((inputs?: Pr_WaitingInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Pr_WaitingInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_pr_waiting(inputs)
	return en_pr_waiting(inputs)
});