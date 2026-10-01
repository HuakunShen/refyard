/**
* | output |
* | --- |
* | "Reset columns to default layout" |
*
* @param {Commit_Reset_ColumnsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_reset_columns: ((inputs?: Commit_Reset_ColumnsInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commit_Reset_ColumnsInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commit_Reset_ColumnsInputs = {};
