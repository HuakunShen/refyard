/**
* | output |
* | --- |
* | "Clean minimal workbench" |
*
* @param {Bg_Solid_DescInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const bg_solid_desc: ((inputs?: Bg_Solid_DescInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Bg_Solid_DescInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Bg_Solid_DescInputs = {};
