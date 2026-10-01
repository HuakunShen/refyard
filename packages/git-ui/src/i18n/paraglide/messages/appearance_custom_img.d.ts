/**
* | output |
* | --- |
* | "Custom image URL (https://...)" |
*
* @param {Appearance_Custom_ImgInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_custom_img: ((inputs?: Appearance_Custom_ImgInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Appearance_Custom_ImgInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Appearance_Custom_ImgInputs = {};
