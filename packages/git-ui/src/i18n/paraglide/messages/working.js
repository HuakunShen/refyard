/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} WorkingInputs */

const en_working = /** @type {(inputs: WorkingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Working…`)
};

const zh_working = /** @type {(inputs: WorkingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`处理中…`)
};

/**
* | output |
* | --- |
* | "Working…" |
*
* @param {WorkingInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working = /** @type {((inputs?: WorkingInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<WorkingInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_working(inputs)
	return en_working(inputs)
});