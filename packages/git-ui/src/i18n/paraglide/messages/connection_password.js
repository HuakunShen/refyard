/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Connection_PasswordInputs */

const en_connection_password = /** @type {(inputs: Connection_PasswordInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Hosted service password`)
};

const zh_connection_password = /** @type {(inputs: Connection_PasswordInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`托管服务密码`)
};

/**
* | output |
* | --- |
* | "Hosted service password" |
*
* @param {Connection_PasswordInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const connection_password = /** @type {((inputs?: Connection_PasswordInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Connection_PasswordInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_connection_password(inputs)
	return en_connection_password(inputs)
});