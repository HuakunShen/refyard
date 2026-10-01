/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commitref_AnnotationInputs */

const en_commitref_annotation = /** @type {(inputs: Commitref_AnnotationInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Annotation (optional)`)
};

const zh_commitref_annotation = /** @type {(inputs: Commitref_AnnotationInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`附注(可选)`)
};

/**
* | output |
* | --- |
* | "Annotation (optional)" |
*
* @param {Commitref_AnnotationInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commitref_annotation = /** @type {((inputs?: Commitref_AnnotationInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commitref_AnnotationInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commitref_annotation(inputs)
	return en_commitref_annotation(inputs)
});