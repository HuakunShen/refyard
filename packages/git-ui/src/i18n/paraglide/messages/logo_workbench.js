/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Logo_WorkbenchInputs */

const en_logo_workbench = /** @type {(inputs: Logo_WorkbenchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Workbench`)
};

const zh_logo_workbench = /** @type {(inputs: Logo_WorkbenchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`工作台`)
};

/**
* | output |
* | --- |
* | "Workbench" |
*
* @param {Logo_WorkbenchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const logo_workbench = /** @type {((inputs?: Logo_WorkbenchInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Logo_WorkbenchInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_logo_workbench(inputs)
	return en_logo_workbench(inputs)
});