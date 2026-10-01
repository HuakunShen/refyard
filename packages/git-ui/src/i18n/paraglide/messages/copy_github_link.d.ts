/**
* | output |
* | --- |
* | "Copy GitHub link" |
*
* @param {Copy_Github_LinkInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_github_link: ((inputs?: Copy_Github_LinkInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Copy_Github_LinkInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Copy_Github_LinkInputs = {};
