/**
* | output |
* | --- |
* | "Stage all {n} changed path(s)" |
*
* @param {Toolbar_Stage_All_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_stage_all_title: ((inputs: Toolbar_Stage_All_TitleInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Toolbar_Stage_All_TitleInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Toolbar_Stage_All_TitleInputs = {
    n: NonNullable<unknown>;
};
