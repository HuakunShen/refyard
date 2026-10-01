/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Abort_And_RestoreInputs */

const en_abort_and_restore = /** @type {(inputs: Abort_And_RestoreInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Abort and restore the state it started from`)
};

const zh_abort_and_restore = /** @type {(inputs: Abort_And_RestoreInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`中止并恢复到开始时的状态`)
};

/**
* | output |
* | --- |
* | "Abort and restore the state it started from" |
*
* @param {Abort_And_RestoreInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const abort_and_restore = /** @type {((inputs?: Abort_And_RestoreInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Abort_And_RestoreInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_abort_and_restore(inputs)
	return en_abort_and_restore(inputs)
});