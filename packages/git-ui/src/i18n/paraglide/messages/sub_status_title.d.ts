/**
* | output |
* | --- |
* | "HEAD / index / checkout" |
*
* @param {Sub_Status_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sub_status_title: ((inputs?: Sub_Status_TitleInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Sub_Status_TitleInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Sub_Status_TitleInputs = {};
