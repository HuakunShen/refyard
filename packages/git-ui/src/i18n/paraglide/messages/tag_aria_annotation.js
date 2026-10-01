/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Tag_Aria_AnnotationInputs */

const en_tag_aria_annotation = /** @type {(inputs: Tag_Aria_AnnotationInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`tag annotation`)
};

const zh_tag_aria_annotation = /** @type {(inputs: Tag_Aria_AnnotationInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`标签附注`)
};

/**
* | output |
* | --- |
* | "tag annotation" |
*
* @param {Tag_Aria_AnnotationInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const tag_aria_annotation = /** @type {((inputs?: Tag_Aria_AnnotationInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Tag_Aria_AnnotationInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_tag_aria_annotation(inputs)
	return en_tag_aria_annotation(inputs)
});