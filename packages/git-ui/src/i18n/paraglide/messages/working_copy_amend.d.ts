/**
* | output |
* | --- |
* | "Amend…" |
*
* @param {Working_Copy_AmendInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_amend: ((inputs?: Working_Copy_AmendInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Working_Copy_AmendInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Working_Copy_AmendInputs = {};
