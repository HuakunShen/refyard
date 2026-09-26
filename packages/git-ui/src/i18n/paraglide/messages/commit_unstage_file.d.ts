/**
* | output |
* | --- |
* | "Unstage file" |
*
* @param {Commit_Unstage_FileInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_unstage_file: ((inputs?: Commit_Unstage_FileInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commit_Unstage_FileInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commit_Unstage_FileInputs = {};
