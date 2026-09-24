/**
* | output |
* | --- |
* | "Stage all" |
*
* @param {Working_Copy_Stage_AllInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_stage_all: ((inputs?: Working_Copy_Stage_AllInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Working_Copy_Stage_AllInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Working_Copy_Stage_AllInputs = {};
