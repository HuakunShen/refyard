/**
* | output |
* | --- |
* | "All files" |
*
* @param {Filters_All_FilesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_all_files: ((inputs?: Filters_All_FilesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filters_All_FilesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filters_All_FilesInputs = {};
