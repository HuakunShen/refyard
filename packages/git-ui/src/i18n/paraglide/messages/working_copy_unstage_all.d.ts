/**
* | output |
* | --- |
* | "Unstage all" |
*
* @param {Working_Copy_Unstage_AllInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_unstage_all: ((inputs?: Working_Copy_Unstage_AllInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Working_Copy_Unstage_AllInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Working_Copy_Unstage_AllInputs = {};
