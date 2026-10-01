/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Exec_Reading_SshInputs */

const en_exec_reading_ssh = /** @type {(inputs: Exec_Reading_SshInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Reading the host's SSH configuration…`)
};

const zh_exec_reading_ssh = /** @type {(inputs: Exec_Reading_SshInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`正在读取宿主的 SSH 配置…`)
};

/**
* | output |
* | --- |
* | "Reading the host's SSH configuration…" |
*
* @param {Exec_Reading_SshInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const exec_reading_ssh = /** @type {((inputs?: Exec_Reading_SshInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Exec_Reading_SshInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_exec_reading_ssh(inputs)
	return en_exec_reading_ssh(inputs)
});