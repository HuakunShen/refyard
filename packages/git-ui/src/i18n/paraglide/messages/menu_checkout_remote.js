/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ remote: NonNullable<unknown>, branch: NonNullable<unknown> }} Menu_Checkout_RemoteInputs */

const en_menu_checkout_remote = /** @type {(inputs: Menu_Checkout_RemoteInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Checkout ${i?.remote}/${i?.branch} as Local Branch`)
};

const zh_menu_checkout_remote = /** @type {(inputs: Menu_Checkout_RemoteInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`将 ${i?.remote}/${i?.branch} 切换为本地分支`)
};

/**
* | output |
* | --- |
* | "Checkout {remote}/{branch} as Local Branch" |
*
* @param {Menu_Checkout_RemoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_checkout_remote = /** @type {((inputs: Menu_Checkout_RemoteInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Menu_Checkout_RemoteInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_menu_checkout_remote(inputs)
	return en_menu_checkout_remote(inputs)
});