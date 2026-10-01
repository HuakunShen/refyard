/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} ConnectingInputs */

const en_connecting = /** @type {(inputs: ConnectingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Connecting…`)
};

const zh_connecting = /** @type {(inputs: ConnectingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`连接中…`)
};

/**
* | output |
* | --- |
* | "Connecting…" |
*
* @param {ConnectingInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const connecting = /** @type {((inputs?: ConnectingInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<ConnectingInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_connecting(inputs)
	return en_connecting(inputs)
});