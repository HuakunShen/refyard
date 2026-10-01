/**
* | output |
* | --- |
* | "Dark Aurora" |
*
* @param {Bg_AuroraInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const bg_aurora: ((inputs?: Bg_AuroraInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Bg_AuroraInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Bg_AuroraInputs = {};
