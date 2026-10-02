/**
* | output |
* | --- |
* | "Stage all changes" |
*
* @param {Toolbar_Stage_AllInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_stage_all: ((inputs?: Toolbar_Stage_AllInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Toolbar_Stage_AllInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Toolbar_Stage_AllInputs = {};
