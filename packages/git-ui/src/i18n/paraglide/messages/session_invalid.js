/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Session_InvalidInputs */

const en_session_invalid = /** @type {(inputs: Session_InvalidInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`The session is no longer valid`)
};

const zh_session_invalid = /** @type {(inputs: Session_InvalidInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`会话已失效`)
};

/**
* | output |
* | --- |
* | "The session is no longer valid" |
*
* @param {Session_InvalidInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const session_invalid = /** @type {((inputs?: Session_InvalidInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Session_InvalidInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_session_invalid(inputs)
	return en_session_invalid(inputs)
});