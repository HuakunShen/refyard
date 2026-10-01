/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Connection_Password_HintInputs */

const en_connection_password_hint = /** @type {(inputs: Connection_Password_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Enter the password configured on the CLI`)
};

const zh_connection_password_hint = /** @type {(inputs: Connection_Password_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`输入在 CLI 上配置的密码`)
};

/**
* | output |
* | --- |
* | "Enter the password configured on the CLI" |
*
* @param {Connection_Password_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const connection_password_hint = /** @type {((inputs?: Connection_Password_HintInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Connection_Password_HintInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_connection_password_hint(inputs)
	return en_connection_password_hint(inputs)
});