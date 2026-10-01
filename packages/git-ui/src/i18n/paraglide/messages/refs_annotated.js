/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Refs_AnnotatedInputs */

const en_refs_annotated = /** @type {(inputs: Refs_AnnotatedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`annotated`)
};

const zh_refs_annotated = /** @type {(inputs: Refs_AnnotatedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`附注`)
};

/**
* | output |
* | --- |
* | "annotated" |
*
* @param {Refs_AnnotatedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const refs_annotated = /** @type {((inputs?: Refs_AnnotatedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Refs_AnnotatedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_refs_annotated(inputs)
	return en_refs_annotated(inputs)
});