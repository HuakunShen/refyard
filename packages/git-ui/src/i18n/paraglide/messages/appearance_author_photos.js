/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Appearance_Author_PhotosInputs */

const en_appearance_author_photos = /** @type {(inputs: Appearance_Author_PhotosInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Author Photos`)
};

const zh_appearance_author_photos = /** @type {(inputs: Appearance_Author_PhotosInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`作者头像`)
};

/**
* | output |
* | --- |
* | "Author Photos" |
*
* @param {Appearance_Author_PhotosInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_author_photos = /** @type {((inputs?: Appearance_Author_PhotosInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Appearance_Author_PhotosInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_appearance_author_photos(inputs)
	return en_appearance_author_photos(inputs)
});