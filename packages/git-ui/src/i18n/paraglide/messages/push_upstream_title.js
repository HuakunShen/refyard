/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ branch: NonNullable<unknown> }} Push_Upstream_TitleInputs */

const en_push_upstream_title = /** @type {(inputs: Push_Upstream_TitleInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`What remote/branch should "${i?.branch}" push to and pull from?`)
};

const zh_push_upstream_title = /** @type {(inputs: Push_Upstream_TitleInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`“${i?.branch}”要推送并拉取到哪个远程/分支？`)
};

/**
* | output |
* | --- |
* | "What remote/branch should \"{branch}\" push to and pull from?" |
*
* @param {Push_Upstream_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const push_upstream_title = /** @type {((inputs: Push_Upstream_TitleInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Upstream_TitleInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_push_upstream_title(inputs)
	return en_push_upstream_title(inputs)
});