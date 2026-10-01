/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Appearance_Author_Photos_DescriptionInputs */

const en_appearance_author_photos_description = /** @type {(inputs: Appearance_Author_Photos_DescriptionInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Photos inside commit nodes: GitHub for noreply emails, Gravatar for other emails. Missing photos use initials. Turning this off stops photo requests.`)
};

const zh_appearance_author_photos_description = /** @type {(inputs: Appearance_Author_Photos_DescriptionInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`提交节点内显示头像：GitHub noreply 邮箱使用 GitHub，其他邮箱通过 Gravatar 匹配。无照片时显示姓名缩写；关闭后停止头像请求。`)
};

/**
* | output |
* | --- |
* | "Photos inside commit nodes: GitHub for noreply emails, Gravatar for other emails. Missing photos use initials. Turning this off stops photo requests." |
*
* @param {Appearance_Author_Photos_DescriptionInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_author_photos_description = /** @type {((inputs?: Appearance_Author_Photos_DescriptionInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Appearance_Author_Photos_DescriptionInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_appearance_author_photos_description(inputs)
	return en_appearance_author_photos_description(inputs)
});