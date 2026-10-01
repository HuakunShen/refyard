/**
* | output |
* | --- |
* | "WIP" |
*
* @param {Wip_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const wip_title: ((inputs?: Wip_TitleInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Wip_TitleInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Wip_TitleInputs = {};
