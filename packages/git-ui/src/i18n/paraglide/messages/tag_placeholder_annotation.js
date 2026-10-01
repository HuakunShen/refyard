/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Tag_Placeholder_AnnotationInputs */

const en_tag_placeholder_annotation = /** @type {(inputs: Tag_Placeholder_AnnotationInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`annotation (empty = lightweight)`)
};

const zh_tag_placeholder_annotation = /** @type {(inputs: Tag_Placeholder_AnnotationInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`附注(留空即轻量标签)`)
};

/**
* | output |
* | --- |
* | "annotation (empty = lightweight)" |
*
* @param {Tag_Placeholder_AnnotationInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const tag_placeholder_annotation = /** @type {((inputs?: Tag_Placeholder_AnnotationInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Tag_Placeholder_AnnotationInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_tag_placeholder_annotation(inputs)
	return en_tag_placeholder_annotation(inputs)
});