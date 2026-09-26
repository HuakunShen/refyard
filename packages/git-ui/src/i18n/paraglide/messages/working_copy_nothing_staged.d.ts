/**
* | output |
* | --- |
* | "Nothing staged." |
*
* @param {Working_Copy_Nothing_StagedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_nothing_staged: ((inputs?: Working_Copy_Nothing_StagedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Working_Copy_Nothing_StagedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Working_Copy_Nothing_StagedInputs = {};
